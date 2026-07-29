//! Dynamic connection progress UI (WinForms) + headless terminal reporting.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static HEADLESS: Mutex<bool> = Mutex::new(false);
static GUI_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn progress_dir() -> PathBuf {
    let dir = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
        .join("WIN_32");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn progress_file() -> PathBuf {
    progress_dir().join("connection.progress")
}

pub fn set_headless(enabled: bool) {
    if let Ok(mut flag) = HEADLESS.lock() {
        *flag = enabled;
    }
}

pub fn is_headless() -> bool {
    HEADLESS.lock().map(|f| *f).unwrap_or(false)
}

fn escape_ps(s: &str) -> String {
    s.replace('\'', "''")
}

fn write_progress_line(line: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(progress_file())
    {
        let _ = writeln!(file, "{}", line);
        let _ = file.flush();
    }
}

/// Emit a visible progress step. In headless mode prints to the terminal.
pub fn step(index: u32, total: u32, message: &str, state: &str) {
    let line = format!("step|{}|{}|{}|{}", index, total, state, message.replace('|', "/"));
    write_progress_line(&line);
    crate::connection_status::log(format!("[{}/{}] {} ({})", index, total, message, state));

    if is_headless() {
        let icon = match state {
            "ok" => "[OK]",
            "fail" => "[FAIL]",
            "warn" => "[WARN]",
            _ => "[..]",
        };
        println!("{} ({}/{}) {}", icon, index, total, message);
        let _ = std::io::Write::flush(&mut std::io::stdout());
    }
}

pub fn finish_success(device: &str, gateway: &str) {
    write_progress_line(&format!("final|connected|{}|{}", device, gateway));
    if is_headless() {
        println!("[SUCCESS] Connected as {} via {}", device, gateway);
        let _ = std::io::Write::flush(&mut std::io::stdout());
    }
}

pub fn finish_failed(reason: &str) {
    write_progress_line(&format!("final|failed|{}", reason.replace('|', "/")));
    if is_headless() {
        eprintln!("[FAILED] {}", reason);
        let _ = std::io::Write::flush(&mut std::io::stderr());
    }
}

pub fn finish_warning(message: &str) {
    write_progress_line(&format!("final|warn|{}", message.replace('|', "/")));
    if is_headless() {
        println!("[WARN] {}", message);
        let _ = std::io::Write::flush(&mut std::io::stdout());
    }
}

/// Launch a non-blocking WinForms progress window that polls connection.progress.
#[cfg(windows)]
pub fn start_gui() {
    if is_headless() {
        return;
    }

    let path = progress_file();
    let _ = fs::write(&path, "step|0|6|running|Starting Zenvora Agent...");

    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$path = '{path}'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Zenvora Agent - Connecting'
$form.Size = New-Object System.Drawing.Size(520, 360)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(248,249,251)
$title = New-Object System.Windows.Forms.Label
$title.Text = 'Establishing gateway connection'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 16)
$status = New-Object System.Windows.Forms.Label
$status.Text = 'Preparing...'
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(20, 48)
$list = New-Object System.Windows.Forms.ListBox
$list.Location = New-Object System.Drawing.Point(20, 80)
$list.Size = New-Object System.Drawing.Size(460, 190)
$list.Font = New-Object System.Drawing.Font('Consolas', 9)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 280)
$bar.Size = New-Object System.Drawing.Size(360, 18)
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'Close'
$btn.Enabled = $false
$btn.Location = New-Object System.Drawing.Point(400, 274)
$btn.Size = New-Object System.Drawing.Size(80, 28)
$btn.Add_Click({{ $form.Close() }})
$form.Controls.AddRange(@($title,$status,$list,$bar,$btn))
$done = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 600
$timer.Add_Tick({{
  if (-not (Test-Path $path)) {{ return }}
  $line = (Get-Content -Path $path -ErrorAction SilentlyContinue | Select-Object -Last 1)
  if (-not $line) {{ return }}
  $parts = $line -split '\|', 5
  if ($parts[0] -eq 'step' -and $parts.Length -ge 5) {{
    $idx = $parts[1]; $total = $parts[2]; $state = $parts[3]; $msg = $parts[4]
    $prefix = switch ($state) {{ 'ok' {{ '[OK]  ' }} 'fail' {{ '[FAIL]' }} 'warn' {{ '[WARN]' }} default {{ '[..]  ' }} }}
    $entry = "$prefix ($idx/$total) $msg"
    if ($list.Items.Count -eq 0 -or $list.Items[$list.Items.Count-1] -ne $entry) {{
      if ($state -eq 'running' -and $list.Items.Count -gt 0 -and ($list.Items[$list.Items.Count-1] -like '*[..]*')) {{
        $list.Items[$list.Items.Count-1] = $entry
      }} else {{
        [void]$list.Items.Add($entry)
      }}
      $list.TopIndex = [Math]::Max(0, $list.Items.Count - 1)
    }}
    $status.Text = $msg
    if ($total -as [int] -gt 0) {{
      $bar.Style = 'Continuous'
      $bar.Maximum = [Math]::Max(1, [int]$total)
      $bar.Value = [Math]::Min([int]$idx, $bar.Maximum)
    }}
  }} elseif ($parts[0] -eq 'final') {{
    if ($done) {{ return }}
    $done = $true
    $bar.Style = 'Continuous'
    $bar.Value = $bar.Maximum
    if ($parts[1] -eq 'connected') {{
      $status.ForeColor = [System.Drawing.Color]::DarkGreen
      $status.Text = 'Connected successfully'
      $title.Text = 'Connection established'
      [void]$list.Items.Add('[OK] Device: ' + $parts[2])
      [void]$list.Items.Add('[OK] Gateway: ' + $parts[3])
    }} elseif ($parts[1] -eq 'warn') {{
      $status.ForeColor = [System.Drawing.Color]::DarkOrange
      $status.Text = $parts[2]
      $title.Text = 'Still connecting'
      [void]$list.Items.Add('[WARN] ' + $parts[2])
    }} else {{
      $status.ForeColor = [System.Drawing.Color]::DarkRed
      $status.Text = 'Connection failed'
      $title.Text = 'Connection failed'
      [void]$list.Items.Add('[FAIL] ' + ($parts[2..($parts.Length-1)] -join '|'))
    }}
    $btn.Enabled = $true
    $timer.Stop()
  }}
}})
$timer.Start()
[void]$form.ShowDialog()
"#,
        path = escape_ps(&path.to_string_lossy())
    );

    let child = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-STA",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .spawn();

    if let Ok(child) = child {
        if let Ok(mut slot) = GUI_CHILD.lock() {
            *slot = Some(child);
        }
    }
}

#[cfg(not(windows))]
pub fn start_gui() {}

pub fn wait_gui_closed() {
    if let Ok(mut slot) = GUI_CHILD.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.wait();
        }
    }
}
