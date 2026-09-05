use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn status_dir() -> PathBuf {
    let dir = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join(crate::paths::AGENT_DIR_NAME);
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn status_file() -> PathBuf {
    status_dir().join("connection.status")
}

pub fn log_file() -> PathBuf {
    status_dir().join("agent.log")
}

pub fn clear_status() {
    let _ = fs::remove_file(status_file());
}

pub fn write_status(line: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(status_file())
    {
        let _ = writeln!(file, "{}", line);
        let _ = file.flush();
    }
}

pub fn read_status() -> Option<String> {
    fs::read_to_string(status_file())
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

pub fn log(message: impl AsRef<str>) {
    let line = format!(
        "[{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        message.as_ref()
    );
    println!("{}", line.trim_end());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_file()) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn mark_bootstrap_waiting() {
    clear_status();
}

pub fn report_connecting(device_id: &str, gateway_url: &str) {
    // Progress only — does not count as final result for bootstrap.
    write_status(&format!("connecting|{}|{}", device_id, gateway_url));
}

pub fn report_connected(device_id: &str, gateway_url: &str) {
    write_status(&format!("connected|{}|{}", device_id, gateway_url));
}

pub fn report_failed(reason: &str) {
    write_status(&format!("failed|{}", reason.replace('\n', " ")));
}

pub fn reset_connect_report() {
    clear_status();
}

pub fn is_final_status(status: &str) -> bool {
    status.starts_with("connected|") || status.starts_with("failed|")
}
