use winreg::RegKey;
use chrono::Local;
use serde_json::json;
use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppHistory {
    pub app_name: String,
    pub executable_path: String,
    pub last_opened: String,
    pub app_type: String, // "app" or "file"
    #[serde(default)]
    pub windows_user: String,
}

pub struct AppHistoryCollector;

impl AppHistoryCollector {
    pub fn collect_all_app_history() -> Vec<AppHistory> {
        let mut history = Vec::new();

        for home in Self::windows_user_homes() {
            let user = home
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".into());
            history.extend(Self::collect_recent_files_from(&home, &user));
        }

        if let Some(home) = dirs::home_dir() {
            let user = whoami::username();
            history.extend(Self::collect_recent_files_from(&home, &user));
        }

        history.extend(Self::collect_running_processes());
        history.extend(Self::collect_registry_recent_apps());

        history.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
        history.dedup_by(|a, b| {
            a.app_name == b.app_name
                && a.executable_path == b.executable_path
                && a.windows_user == b.windows_user
        });
        history
    }

    fn windows_user_homes() -> Vec<PathBuf> {
        let mut homes = Vec::new();
        let users_dir = PathBuf::from(r"C:\Users");
        if let Ok(entries) = std::fs::read_dir(&users_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if matches!(
                    name.as_str(),
                    "Public" | "Default" | "Default User" | "All Users" | "desktop.ini"
                ) {
                    continue;
                }
                let path = entry.path();
                if path.is_dir() {
                    homes.push(path);
                }
            }
        }
        homes
    }

    fn collect_recent_files_from(home: &Path, windows_user: &str) -> Vec<AppHistory> {
        let mut recent = Vec::new();
        let recent_path = home.join(r"AppData\Roaming\Microsoft\Windows\Recent");

        if let Ok(entries) = std::fs::read_dir(&recent_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if let Ok(metadata) = std::fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        let last_opened = match std::time::SystemTime::now().duration_since(modified) {
                            Ok(_) => Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                            Err(_) => "Unknown".to_string(),
                        };

                        let file_name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Unknown")
                            .to_string();

                        recent.push(AppHistory {
                            app_name: file_name,
                            executable_path: path.to_string_lossy().to_string(),
                            last_opened,
                            app_type: "file".to_string(),
                            windows_user: windows_user.to_string(),
                        });
                    }
                }
            }
        }

        recent
    }

    fn collect_running_processes() -> Vec<AppHistory> {
        let mut processes = Vec::new();
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let user = whoami::username();

        #[cfg(target_os = "windows")]
        {
            if let Ok(output) = Command::new("tasklist")
                .creation_flags(CREATE_NO_WINDOW)
                .arg("/v")
                .arg("/fo")
                .arg("csv")
                .output()
            {
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    for line in stdout.lines().skip(1) {
                        let parts: Vec<&str> = line.split(',').collect();
                        if parts.is_empty() {
                            continue;
                        }
                        let app_name = parts[0].trim_matches('"').to_string();
                        if !app_name.is_empty() {
                            processes.push(AppHistory {
                                app_name,
                                executable_path: String::new(),
                                last_opened: now.clone(),
                                app_type: "process".to_string(),
                                windows_user: user.clone(),
                            });
                        }
                    }
                }
            }
        }

        processes
    }

    fn collect_registry_recent_apps() -> Vec<AppHistory> {
        let mut apps = Vec::new();
        let user = whoami::username();

        if let Ok(hklm) = RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU")
        {
            let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

            for (name, _) in hklm.enum_values().flatten() {
                if let Ok(val) = hklm.get_value::<String, _>(&name) {
                    if !val.is_empty() && name != "HRZR_PGYFRFFAT" {
                        let app_path = val.split('\0').next().unwrap_or(&val).to_string();
                        let app_name = app_path
                            .split('\\')
                            .last()
                            .unwrap_or(&app_path)
                            .to_string();

                        apps.push(AppHistory {
                            app_name,
                            executable_path: app_path,
                            last_opened: now.clone(),
                            app_type: "app".to_string(),
                            windows_user: user.clone(),
                        });
                    }
                }
            }
        }

        apps
    }

    pub fn to_json_array(apps: &[AppHistory]) -> serde_json::Value {
        json!(apps.iter().map(|a| json!({
            "appName": a.app_name,
            "executablePath": a.executable_path,
            "lastOpened": a.last_opened,
            "appType": a.app_type,
            "windowsUser": a.windows_user,
        })).collect::<Vec<_>>())
    }
}
