//! Dynamic connection progress UI (WinForms) + headless terminal reporting.
//! GUI theme matches the Zenvora browser app (cream background, dark brand type).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use crate::messages::{self, Msg};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static HEADLESS: Mutex<bool> = Mutex::new(false);
static GUI_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn progress_dir() -> PathBuf {
    let dir = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join(crate::paths::AGENT_DIR_NAME);
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

fn state_for_msg(msg: Msg) -> &'static str {
    match msg.kind {
        messages::MsgKind::Success => "ok",
        messages::MsgKind::Error => "fail",
        messages::MsgKind::Warn => "warn",
        messages::MsgKind::Info => "running",
    }
}

/// Emit a coded production progress step.
pub fn step_msg(index: u32, total: u32, msg: Msg) {
    step(index, total, &msg.display(), state_for_msg(msg));
}

pub fn step_msg_detail(index: u32, total: u32, msg: Msg, detail: &str) {
    step(index, total, &msg.with_detail(detail), state_for_msg(msg));
}

/// Emit a visible progress step. In headless mode prints to the terminal.
pub fn step(index: u32, total: u32, message: &str, state: &str) {
    let line = format!("step|{}|{}|{}|{}", index, total, state, message.replace('|', "/"));
    write_progress_line(&line);
    crate::connection_status::log(format!("[{}/{}] {} ({})", index, total, message, state));
    crate::install_telemetry::step(index, total, message, state);

    let icon = match state {
        "ok" => "[OK]  ",
        "fail" => "[FAIL]",
        "warn" => "[WARN]",
        _ => "[..]  ",
    };
    println!("{} ({}/{}) {}", icon, index, total, message);
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

pub fn finish_success(device: &str, gateway: &str) {
    write_progress_line(&format!("final|connected|{}|{}", device, gateway));
    let msg = format!(
        "{} — {} via {}",
        messages::M200_CONNECTED.display(),
        device,
        gateway
    );
    crate::install_telemetry::finish_success(&msg);
    println!("[SUCCESS] {}", msg);
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

pub fn finish_failed(reason: &str) {
    let text = if reason.contains("[ZENVORA-") {
        reason.to_string()
    } else {
        messages::M501_CONNECT_FAILED.with_detail(reason)
    };
    write_progress_line(&format!("final|failed|{}", text.replace('|', "/")));
    crate::install_telemetry::finish_failed(&text);
    eprintln!("[FAILED] {}", text);
    let _ = std::io::Write::flush(&mut std::io::stderr());
}

pub fn finish_failed_msg(msg: Msg) {
    finish_failed(&msg.display());
}

pub fn finish_failed_msg_detail(msg: Msg, detail: &str) {
    finish_failed(&msg.with_detail(detail));
}

pub fn finish_warning(message: &str) {
    let text = if message.contains("[ZENVORA-") {
        message.to_string()
    } else {
        messages::M112_STILL_CONNECTING.with_detail(message)
    };
    write_progress_line(&format!("final|warn|{}", text.replace('|', "/")));
    crate::install_telemetry::finish_warning(&text);
    println!("[WARN] {}", text);
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

pub fn finish_warning_msg(msg: Msg) {
    finish_warning(&msg.display());
}

/// Launch a non-blocking WinForms progress window that polls connection.progress.
#[cfg(windows)]
pub fn start_gui() {
    if is_headless() {
        return;
    }

    let path = progress_file();
    let _ = fs::write(
        &path,
        format!(
            "step|0|8|running|{}",
            messages::M100_PROVISION_STARTED.display()
        ),
    );

    // Browser theme: cream bg #F9F9F7, ink #1F1C1A, muted #6B6560, success #1F7A4D, error #B42318
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$path = '{path}'

$bg     = [System.Drawing.Color]::FromArgb(249,249,247)
$ink    = [System.Drawing.Color]::FromArgb(31,28,26)
$muted  = [System.Drawing.Color]::FromArgb(107,101,96)
$line   = [System.Drawing.Color]::FromArgb(224,220,214)
$card   = [System.Drawing.Color]::White
$okCol  = [System.Drawing.Color]::FromArgb(31,122,77)
$failCol= [System.Drawing.Color]::FromArgb(180,35,24)
$warnCol= [System.Drawing.Color]::FromArgb(180,110,20)
$barFill= [System.Drawing.Color]::FromArgb(31,28,26)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Zenvora'
$form.Size = New-Object System.Drawing.Size(560, 420)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = $bg
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

# Brand mark (wifi rings — same motif as browser ZenvoraLogo)
$logoBox = New-Object System.Windows.Forms.PictureBox
$logoBox.Location = New-Object System.Drawing.Point(24, 20)
$logoBox.Size = New-Object System.Drawing.Size(48, 48)
$logoBmp = New-Object System.Drawing.Bitmap 96, 96
$g = [System.Drawing.Graphics]::FromImage($logoBmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$pen1 = New-Object System.Drawing.Pen $ink, 3
$pen1.Color = [System.Drawing.Color]::FromArgb(80, 31,28,26)
$pen2 = New-Object System.Drawing.Pen $ink, 3
$pen2.Color = [System.Drawing.Color]::FromArgb(130, 31,28,26)
$pen3 = New-Object System.Drawing.Pen $ink, 3.5
$g.DrawEllipse($pen1, 6, 6, 84, 84)
$g.DrawEllipse($pen2, 18, 18, 60, 60)
$g.DrawEllipse($pen3, 30, 30, 36, 36)
$brush = New-Object System.Drawing.SolidBrush $ink
$g.FillEllipse($brush, 42, 42, 12, 12)
$g.Dispose()
$logoBox.Image = $logoBmp
$logoBox.SizeMode = 'Zoom'

$brand = New-Object System.Windows.Forms.Label
$brand.Text = 'Zenvora'
$brand.Font = New-Object System.Drawing.Font('Georgia', 18, [System.Drawing.FontStyle]::Bold)
$brand.ForeColor = $ink
$brand.AutoSize = $true
$brand.Location = New-Object System.Drawing.Point(84, 18)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Connecting your device'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
$title.ForeColor = $ink
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(86, 48)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Preparing…'
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$status.ForeColor = $muted
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(500, 22)
$status.Location = New-Object System.Drawing.Point(24, 82)

$panel = New-Object System.Windows.Forms.Panel
$panel.Location = New-Object System.Drawing.Point(24, 112)
$panel.Size = New-Object System.Drawing.Size(500, 210)
$panel.BackColor = $card
$panel.BorderStyle = 'FixedSingle'

$list = New-Object System.Windows.Forms.ListBox
$list.Location = New-Object System.Drawing.Point(1, 1)
$list.Size = New-Object System.Drawing.Size(496, 206)
$list.BorderStyle = 'None'
$list.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$list.BackColor = $card
$list.ForeColor = $ink
$list.IntegralHeight = $false
$panel.Controls.Add($list)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(24, 338)
$bar.Size = New-Object System.Drawing.Size(390, 10)
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 28

$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'Close'
$btn.Enabled = $false
$btn.Location = New-Object System.Drawing.Point(430, 328)
$btn.Size = New-Object System.Drawing.Size(94, 30)
$btn.FlatStyle = 'Flat'
$btn.BackColor = $ink
$btn.ForeColor = $bg
$btn.FlatAppearance.BorderSize = 0
$btn.Add_Click({{ $form.Close() }})

$form.Controls.AddRange(@($logoBox,$brand,$title,$status,$panel,$bar,$btn))

$done = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({{
  if (-not (Test-Path $path)) {{ return }}
  $line = (Get-Content -Path $path -ErrorAction SilentlyContinue | Select-Object -Last 1)
  if (-not $line) {{ return }}
  $parts = $line -split '\|', 5
  if ($parts[0] -eq 'step' -and $parts.Length -ge 5) {{
    $idx = $parts[1]; $total = $parts[2]; $state = $parts[3]; $msg = $parts[4]
    $prefix = switch ($state) {{
      'ok'   {{ 'OK' }}
      'fail' {{ 'ERR' }}
      'warn' {{ 'WARN' }}
      default {{ '…' }}
    }}
    $entry = "$prefix  ($idx/$total)  $msg"
    if ($list.Items.Count -eq 0 -or $list.Items[$list.Items.Count-1] -ne $entry) {{
      if ($state -eq 'running' -and $list.Items.Count -gt 0 -and ($list.Items[$list.Items.Count-1] -like '*…*')) {{
        $list.Items[$list.Items.Count-1] = $entry
      }} else {{
        [void]$list.Items.Add($entry)
      }}
      $list.TopIndex = [Math]::Max(0, $list.Items.Count - 1)
    }}
    $status.Text = $msg
    $status.ForeColor = $muted
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
      $status.ForeColor = $okCol
      $status.Text = '[ZENVORA-200] Connected successfully'
      $title.Text = 'You are online'
      [void]$list.Items.Add('OK  Device  ' + $parts[2])
      [void]$list.Items.Add('OK  Gateway  ' + $parts[3])
    }} elseif ($parts[1] -eq 'warn') {{
      $status.ForeColor = $warnCol
      $status.Text = $parts[2]
      $title.Text = 'Almost there'
      [void]$list.Items.Add('WARN  ' + $parts[2])
    }} else {{
      $status.ForeColor = $failCol
      $failMsg = ($parts[2..($parts.Length-1)] -join '|')
      $status.Text = $failMsg
      $title.Text = 'Connection failed'
      [void]$list.Items.Add('ERR  ' + $failMsg)
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
