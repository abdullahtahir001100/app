use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

fn log_path() -> PathBuf {
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        let dir = PathBuf::from(program_data).join(crate::paths::AGENT_DIR_NAME);
        let _ = std::fs::create_dir_all(&dir);
        return dir.join("agent.log");
    }
    PathBuf::from("agent.log")
}

pub fn log(message: impl AsRef<str>) {
    let line = format!(
        "[{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        message.as_ref()
    );

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = file.write_all(line.as_bytes());
    }
}
