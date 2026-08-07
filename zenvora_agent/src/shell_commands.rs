use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde_json::json;

use crate::commands::{CommandResponse, IncomingPacket};

const CHUNK_SIZE: usize = 8 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 120;

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
        self.current_dir.clone().unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        })
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

/// Chunk large strings for WS-safe streaming.
fn chunk_text(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + CHUNK_SIZE).min(bytes.len());
        // Align to char boundary
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

pub fn handle_shell_command(packet: IncomingPacket, shell_state: &mut ShellState) -> Option<CommandResponse> {
    let command = packet
        .payload
        .get("command")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let shell_id = packet
        .payload
        .get("shellId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

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
                    "timed_out": false
                }
            }),
            frame: None,
            frame_kind: 0,
        });
    }

    let output = run_shell_command(&command, shell_state, &shell_id);
    let cwd_after = prompt_cwd(shell_state, &shell_id);

    // For large output, emit chunk markers in the final JSON (server fans out as-is;
    // UI also supports shell_output_chunk if sent as separate packets later).
    let stdout = output.stdout;
    let stderr = output.stderr;
    let stdout_truncated = stdout.len() > 256 * 1024;
    let stderr_truncated = stderr.len() > 256 * 1024;
    let stdout_out = if stdout_truncated {
        let mut s = stdout.chars().take(250_000).collect::<String>();
        s.push_str("\n\n[truncated — output exceeded 256KB]");
        s
    } else {
        stdout
    };
    let stderr_out = if stderr_truncated {
        let mut s = stderr.chars().take(64_000).collect::<String>();
        s.push_str("\n\n[truncated]");
        s
    } else {
        stderr
    };

    // Attach chunks metadata for UI progressive render (same packet).
    let stdout_chunks = chunk_text(&stdout_out);
    let stderr_chunks = chunk_text(&stderr_out);

    Some(CommandResponse {
        json: json!({
            "type": "shell_output",
            "action": packet.action,
            "status": if output.exit_code == 0 { "success" } else { "error" },
            "message": if output.exit_code == 0 { "Shell command completed." } else { "Shell command failed." },
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
    shell_state: &mut ShellState,
    shell_id: &str,
) -> ShellExecutionResult {
    if let Some(result) = try_handle_cd_command(command_text, shell_state, shell_id) {
        return result;
    }

    #[cfg(windows)]
    let mut command = Command::new("cmd");
    #[cfg(windows)]
    {
        // /S so quotes in large/complex commands are preserved correctly.
        command.args(["/D", "/Q", "/S", "/C", command_text]);
        command.creation_flags(0x08000000);
    }

    #[cfg(not(windows))]
    let mut command = Command::new("/bin/sh");
    #[cfg(not(windows))]
    {
        command.arg("-c").arg(command_text);
    }

    let current_dir = shell_state.resolve_current_dir(shell_id);
    command.current_dir(&current_dir);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let started = Instant::now();
    match command.spawn() {
        Ok(mut child) => {
            let mut stdout = String::new();
            let mut stderr = String::new();

            if let Some(out) = child.stdout.take() {
                let mut reader = BufReader::new(out);
                let mut buf = Vec::new();
                let _ = reader.read_to_end(&mut buf);
                stdout = String::from_utf8_lossy(&buf).to_string();
            }
            if let Some(err) = child.stderr.take() {
                let mut reader = BufReader::new(err);
                let mut buf = Vec::new();
                let _ = reader.read_to_end(&mut buf);
                stderr = String::from_utf8_lossy(&buf).to_string();
            }

            let timed_out = started.elapsed() > Duration::from_secs(DEFAULT_TIMEOUT_SECS);
            let status = child.wait();
            let exit_code = match status {
                Ok(s) => s.code().unwrap_or(-1),
                Err(_) => 1,
            };

            ShellExecutionResult {
                exit_code,
                stdout: stdout.trim_end().to_string(),
                stderr: stderr.trim_end().to_string(),
                timed_out,
            }
        }
        Err(err) => ShellExecutionResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("Failed to launch shell: {err}"),
            timed_out: false,
        },
    }
}

fn try_handle_cd_command(
    command_text: &str,
    shell_state: &mut ShellState,
    shell_id: &str,
) -> Option<ShellExecutionResult> {
    let trimmed = command_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let command_name = parts.next().unwrap_or("");
    let is_cd = command_name.eq_ignore_ascii_case("cd") || command_name.eq_ignore_ascii_case("chdir");
    if !is_cd {
        return None;
    }

    let mut target_parts = parts.collect::<Vec<_>>();
    let mut use_d = false;
    if target_parts.first().is_some_and(|part| part.eq_ignore_ascii_case("/d")) {
        use_d = true;
        target_parts.remove(0);
    }

    let target = target_parts.join(" ");
    let base_dir = shell_state.resolve_current_dir(shell_id);

    let resolved = if target.is_empty() {
        base_dir.clone()
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
                stderr: format!("Directory not found: {}", target),
                timed_out: false,
            });
        }
    };

    let mut final_dir = resolved;
    if use_d && final_dir.is_file() {
        final_dir = final_dir.parent().unwrap_or(&base_dir).to_path_buf();
    }

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
        let result = try_handle_cd_command("cd ..", &mut shell_state, "").unwrap();

        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("\\") || result.stdout.contains("/"));
    }
}
