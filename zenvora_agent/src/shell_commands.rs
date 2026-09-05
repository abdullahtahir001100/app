use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::json;

use crate::commands::{CommandResponse, IncomingPacket};

const CHUNK_SIZE: usize = 8 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 180;
const MAX_STDOUT_BYTES: usize = 512 * 1024;
const MAX_STDERR_BYTES: usize = 128 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
/// Do not combine with DETACHED_PROCESS here — shell stdout/stderr are piped and need a console session handle.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellEngine {
    Cmd,
    PowerShell,
}

impl ShellEngine {
    fn parse(raw: &str) -> Self {
        let s = raw.trim().to_ascii_lowercase();
        if matches!(
            s.as_str(),
            "powershell" | "pwsh" | "ps" | "ps1" | "power-shell"
        ) {
            ShellEngine::PowerShell
        } else {
            ShellEngine::Cmd
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            ShellEngine::Cmd => "cmd",
            ShellEngine::PowerShell => "powershell",
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct ShellState {
    current_dir: Option<PathBuf>,
    /// Independent shell sessions keyed by shellId (for multi-window).
    sessions: std::collections::HashMap<String, PathBuf>,
}

impl ShellState {
    pub fn new() -> Self {
        Self::default()
    }

    fn resolve_current_dir(&self, shell_id: &str) -> PathBuf {
        if !shell_id.is_empty() {
            if let Some(dir) = self.sessions.get(shell_id) {
                return dir.clone();
            }
        }
        self.current_dir
            .clone()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    fn set_current_dir(&mut self, dir: PathBuf, shell_id: &str) {
        if !shell_id.is_empty() {
            self.sessions.insert(shell_id.to_string(), dir.clone());
        }
        self.current_dir = Some(dir);
    }
}

pub fn is_shell_action(action: &str) -> bool {
    matches!(action, "SHELL_EXECUTE" | "SHELL_EXECUTE_RAW")
}

fn os_username() -> String {
    whoami::username()
}

fn prompt_cwd(shell_state: &ShellState, shell_id: &str) -> String {
    shell_state
        .resolve_current_dir(shell_id)
        .to_string_lossy()
        .to_string()
}

/// Chunk large strings for WS-safe metadata (UI should prefer full stdout/stderr for fidelity).
fn chunk_text(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + CHUNK_SIZE).min(bytes.len());
        let mut e = end;
        while e > i && !text.is_char_boundary(e) {
            e -= 1;
        }
        if e == i {
            e = end.min(bytes.len());
        }
        out.push(String::from_utf8_lossy(&bytes[i..e]).to_string());
        i = e;
    }
    out
}

fn looks_like_powershell(command: &str) -> bool {
    let t = command.trim_start();
    let lower = t.to_ascii_lowercase();
    lower.starts_with("powershell ")
        || lower.starts_with("pwsh ")
        || lower.starts_with("get-")
        || lower.starts_with("set-")
        || lower.starts_with("write-")
        || lower.starts_with("select-")
        || lower.starts_with("where-")
        || lower.starts_with("foreach-")
        || lower.starts_with("invoke-")
        || lower.starts_with("import-")
        || lower.starts_with("export-")
        || lower.starts_with("new-")
        || lower.starts_with("remove-")
        || lower.starts_with("start-")
        || lower.starts_with("stop-")
        || lower.starts_with("test-")
        || lower.starts_with("convertto-")
        || lower.starts_with("convertfrom-")
        || t.contains("$_")
        || t.contains("|%")
        || t.contains("|$")
        || t.contains(".ps1")
}

fn resolve_engine(packet: &IncomingPacket, command: &str) -> ShellEngine {
    if let Some(raw) = packet
        .payload
        .get("shell")
        .or_else(|| packet.payload.get("engine"))
        .and_then(|v| v.as_str())
    {
        return ShellEngine::parse(raw);
    }
    if looks_like_powershell(command) {
        ShellEngine::PowerShell
    } else {
        ShellEngine::Cmd
    }
}

/// Decode console pipe bytes without mangling original text.
fn decode_console_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    // UTF-8 (preferred when we force UTF-8 from PowerShell / modern tools)
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }

    // UTF-16LE (cmd /U pipes, some PowerShell redirects)
    if bytes.len() >= 2 {
        let (start, aligned) = if bytes[0] == 0xFF && bytes[1] == 0xFE {
            (2usize, true)
        } else if bytes.len() % 2 == 0 {
            // Heuristic: many 0x00 on odd indexes → UTF-16LE ASCII-heavy text
            let zero_odd = bytes.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
            (0usize, zero_odd * 2 >= bytes.len() / 2)
        } else {
            (0usize, false)
        };
        if aligned {
            let slice = &bytes[start..];
            if slice.len() >= 2 && slice.len() % 2 == 0 {
                let u16s: Vec<u16> = slice
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                if let Ok(s) = String::from_utf16(&u16s) {
                    return s;
                }
            }
        }
    }

    String::from_utf8_lossy(bytes).into_owned()
}

fn maybe_truncate(text: String, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text, false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = text[..end].to_string();
    out.push_str("\n\n[truncated — output exceeded limit]");
    (out, true)
}

pub fn handle_shell_command(
    packet: IncomingPacket,
    shell_state: &mut ShellState,
) -> Option<CommandResponse> {
    let command = packet
        .payload
        .get("command")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    // Keep leading spaces if user typed them; only reject empty/whitespace-only.
    let command_trim = command.trim();
    let command = if command_trim.is_empty() {
        String::new()
    } else {
        command_trim.to_string()
    };

    let shell_id = packet
        .payload
        .get("shellId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let engine = resolve_engine(&packet, &command);
    let username = os_username();
    let cwd = prompt_cwd(shell_state, &shell_id);

    if command.is_empty() {
        return Some(CommandResponse {
            json: json!({
                "type": "shell_output",
                "action": packet.action,
                "status": "error",
                "message": "No shell command provided.",
                "shell": {
                    "command": "",
                    "exit_code": 1,
                    "stdout": "",
                    "stderr": "No shell command provided.",
                    "username": username,
                    "cwd": cwd,
                    "shellId": shell_id,
                    "shell": engine.as_str(),
                    "timed_out": false
                }
            }),
            frame: None,
            frame_kind: 0,
        });
    }

    let output = run_shell_command(&command, engine, shell_state, &shell_id);
    let cwd_after = prompt_cwd(shell_state, &shell_id);

    let (stdout_out, _) = maybe_truncate(output.stdout, MAX_STDOUT_BYTES);
    let (stderr_out, _) = maybe_truncate(output.stderr, MAX_STDERR_BYTES);
    let stdout_chunks = chunk_text(&stdout_out);
    let stderr_chunks = chunk_text(&stderr_out);

    Some(CommandResponse {
        json: json!({
            "type": "shell_output",
            "action": packet.action,
            "status": if output.exit_code == 0 { "success" } else { "error" },
            "message": if output.exit_code == 0 {
                "Shell command completed."
            } else {
                "Shell command failed."
            },
            "shell": {
                "command": command,
                "exit_code": output.exit_code,
                "stdout": stdout_out,
                "stderr": stderr_out,
                "stdoutChunks": stdout_chunks,
                "stderrChunks": stderr_chunks,
                "username": username,
                "cwd": cwd_after,
                "shellId": shell_id,
                "shell": engine.as_str(),
                "timed_out": output.timed_out
            }
        }),
        frame: None,
        frame_kind: 0,
    })
}

struct ShellExecutionResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn run_shell_command(
    command_text: &str,
    engine: ShellEngine,
    shell_state: &mut ShellState,
    shell_id: &str,
) -> ShellExecutionResult {
    if let Some(result) = try_handle_cd_command(command_text, engine, shell_state, shell_id) {
        return result;
    }

    let current_dir = shell_state.resolve_current_dir(shell_id);
    let mut command = match engine {
        ShellEngine::Cmd => build_cmd_command(command_text),
        ShellEngine::PowerShell => build_powershell_command(command_text),
    };

    command.current_dir(&current_dir);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    // Inherit a minimal env; force UTF-8 hints where tools honor them.
    command.env("PYTHONIOENCODING", "utf-8");
    command.env("DOTNET_CLI_UI_LANGUAGE", "en");

    let started = Instant::now();
    match command.spawn() {
        Ok(mut child) => {
            let mut stdout_bytes = Vec::new();
            let mut stderr_bytes = Vec::new();

            if let Some(out) = child.stdout.take() {
                let mut reader = BufReader::new(out);
                let _ = reader.read_to_end(&mut stdout_bytes);
            }
            if let Some(err) = child.stderr.take() {
                let mut reader = BufReader::new(err);
                let _ = reader.read_to_end(&mut stderr_bytes);
            }

            let timed_out = started.elapsed() > Duration::from_secs(DEFAULT_TIMEOUT_SECS);
            if timed_out {
                let _ = child.kill();
            }
            let status = child.wait();
            let exit_code = match status {
                Ok(s) => s.code().unwrap_or(if timed_out { 124 } else { -1 }),
                Err(_) => 1,
            };

            ShellExecutionResult {
                exit_code,
                // Keep original text — do not trim (preserves trailing spaces / blank lines).
                stdout: decode_console_bytes(&stdout_bytes),
                stderr: decode_console_bytes(&stderr_bytes),
                timed_out,
            }
        }
        Err(err) => ShellExecutionResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("Failed to launch {}: {err}", engine.as_str()),
            timed_out: false,
        },
    }
}

#[cfg(windows)]
fn build_cmd_command(command_text: &str) -> Command {
    // /U => Unicode (UTF-16LE) on redirected pipes — faithful text for decode.
    // /S /C => pass command string as-is (supports quotes, pipes, &&, redirects).
    let mut command = Command::new("cmd.exe");
    command.args(["/D", "/S", "/U", "/C", command_text]);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn build_cmd_command(command_text: &str) -> Command {
    let shell = if std::path::Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else if std::path::Path::new("/bin/bash").exists() {
        "/bin/bash"
    } else {
        "/bin/sh"
    };
    let mut command = Command::new(shell);
    command.arg("-c").arg(command_text);
    command
}

#[cfg(windows)]
fn build_powershell_command(command_text: &str) -> Command {
    // Strip an optional leading `powershell ` / `pwsh ` so users can paste either form.
    let script_body = {
        let t = command_text.trim_start();
        let lower = t.to_ascii_lowercase();
        let skip = if lower.starts_with("powershell.exe ") {
            "powershell.exe ".len()
        } else if lower.starts_with("powershell ") {
            "powershell ".len()
        } else if lower.starts_with("pwsh.exe ") {
            "pwsh.exe ".len()
        } else if lower.starts_with("pwsh ") {
            "pwsh ".len()
        } else {
            0
        };
        if skip > 0 {
            t[skip..].trim_start()
        } else {
            command_text
        }
    };

    // Force UTF-8 host output so pipe bytes match what PowerShell shows for text.
    // -WindowStyle Hidden avoids a console flash when opening browsers / Start-Process.
    let wrapped = format!(
        "$ErrorActionPreference='Continue'; \
         try {{ [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; \
         $OutputEncoding = [Console]::OutputEncoding }} catch {{}}; \
         {script_body}"
    );

    // -EncodedCommand avoids cmd/PowerShell quoting breakage on large/complex scripts.
    let utf16: Vec<u8> = wrapped
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    let encoded = B64.encode(utf16);

    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        &encoded,
    ]);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn build_powershell_command(command_text: &str) -> Command {
    if Command::new("pwsh").arg("--version").output().is_ok() {
        let mut command = Command::new("pwsh");
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command_text]);
        command
    } else {
        build_cmd_command(command_text)
    }
}

fn extract_cd_target(command_text: &str) -> Option<String> {
    let trimmed = command_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    let prefix_len = if lower.starts_with("set-location") {
        "set-location".len()
    } else if lower.starts_with("chdir") {
        "chdir".len()
    } else if lower == "cd"
        || lower.starts_with("cd ")
        || lower.starts_with("cd\t")
        || lower.starts_with("cd/")
        || lower.starts_with("cd\\")
    {
        2
    } else if lower.starts_with("sl ") || lower.starts_with("sl\t") || lower.starts_with("sl-") {
        2
    } else {
        return None;
    };

    let mut args = trimmed[prefix_len..].trim_start();
    let args_lower = args.to_ascii_lowercase();
    for flag in ["-literalpath ", "-path ", "/d "] {
        if let Some(stripped) = args_lower.strip_prefix(flag) {
            let skip = args.len() - stripped.len();
            args = args[skip..].trim_start();
            break;
        }
    }

    if args.is_empty() {
        return Some(String::new());
    }

    let bytes = args.as_bytes();
    if bytes[0] == b'"' || bytes[0] == b'\'' {
        let quote = bytes[0] as char;
        if let Some(end) = args[1..].find(quote) {
            return Some(args[1..1 + end].to_string());
        }
    }

    Some(args.trim().to_string())
}

fn try_handle_cd_command(
    command_text: &str,
    _engine: ShellEngine,
    shell_state: &mut ShellState,
    shell_id: &str,
) -> Option<ShellExecutionResult> {
    let target = extract_cd_target(command_text)?;
    let base_dir = shell_state.resolve_current_dir(shell_id);

    let resolved = if target.is_empty() {
        // bare `cd` → show/stay current (cmd) / home-ish — keep current for remote shell fidelity
        base_dir.clone()
    } else if target == "~" {
        dirs::home_dir().unwrap_or(base_dir.clone())
    } else {
        let candidate = if Path::new(&target).is_absolute() {
            PathBuf::from(&target)
        } else {
            base_dir.join(&target)
        };
        if candidate.exists() {
            match fs::canonicalize(&candidate) {
                Ok(path) => path,
                Err(_) => candidate,
            }
        } else {
            return Some(ShellExecutionResult {
                exit_code: 1,
                stdout: String::new(),
                stderr: format!("Directory not found: {target}"),
                timed_out: false,
            });
        }
    };

    let final_dir = if resolved.is_file() {
        resolved
            .parent()
            .unwrap_or(&base_dir)
            .to_path_buf()
    } else {
        resolved
    };

    shell_state.set_current_dir(final_dir.clone(), shell_id);
    Some(ShellExecutionResult {
        exit_code: 0,
        stdout: final_dir.to_string_lossy().to_string(),
        stderr: String::new(),
        timed_out: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cd_command_updates_shell_state() {
        let mut shell_state = ShellState::new();
        let result =
            try_handle_cd_command("cd ..", ShellEngine::Cmd, &mut shell_state, "").unwrap();

        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains('\\') || result.stdout.contains('/'));
    }

    #[test]
    fn detect_powershell_verbs() {
        assert!(looks_like_powershell("Get-Process"));
        assert!(!looks_like_powershell("dir"));
    }
}
