use hostname;
use std::fs;
use std::io::{self, Read, Write};
use std::fs::File;
use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};

use crate::ui_notify;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CONFIG_FILE: &str = "agent.dat";
const XOR_KEY: u8 = 0x5A;

fn get_config_path() -> PathBuf {
    crate::paths::migrate_legacy_file(CONFIG_FILE);
    let modern = crate::paths::data_dir().join(CONFIG_FILE);
    if modern.exists() {
        return modern;
    }
    let legacy = crate::paths::legacy_agent_dir().join(CONFIG_FILE);
    if legacy.exists() {
        return legacy;
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join(CONFIG_FILE);
        }
    }
    modern
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentConfig {
    pub gateway_url: String,
    pub device_id: String,
    pub agent_token: String,
}

fn simple_crypt(data: &[u8]) -> Vec<u8> {
    data.iter().map(|&b| b ^ XOR_KEY).collect()
}

#[cfg(windows)]
fn prompt_input_dialog(title: &str, prompt: &str) -> String {
    let title = title.replace('"', "\\\"");
    let prompt = prompt.replace('"', "\\\"");
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; $result = [Microsoft.VisualBasic.Interaction]::InputBox(\"{}\", \"{}\", \"\"); if ($result -ne $null) {{ Write-Output $result }}",
        prompt,
        title
    );

    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-STA",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

#[cfg(target_os = "macos")]
fn prompt_input_dialog(title: &str, prompt: &str) -> String {
    let logo_path = crate::paths::ensure_logo_file();
    let logo_str = logo_path.to_string_lossy();
    let script = format!(
        r#"text returned of (display dialog "{}" default answer "" with title "{}" with icon POSIX file "{}" buttons {{"Cancel", "Continue"}} default button "Continue")"#,
        prompt.replace('"', "\\\""),
        title.replace('"', "\\\""),
        logo_str.replace('"', "\\\"")
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

#[cfg(target_os = "linux")]
fn prompt_input_dialog(title: &str, prompt: &str) -> String {
    let logo_path = crate::paths::ensure_logo_file();
    let logo_str = logo_path.to_string_lossy();
    if let Ok(output) = Command::new("zenity")
        .args([
            "--entry",
            &format!("--title={}", title),
            &format!("--text={}", prompt),
            &format!("--window-icon={}", logo_str),
        ])
        .output()
    {
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    if let Ok(output) = Command::new("kdialog")
        .args(["--title", title, "--icon", &logo_str, "--inputbox", prompt])
        .output()
    {
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn prompt_input_dialog(_title: &str, _prompt: &str) -> String {
    String::new()
}

fn request_token_input(label: &str, prompt: &str) -> String {
    let input = prompt_input_dialog(label, prompt);
    if !input.is_empty() {
        return input.trim().to_string();
    }

    // No console/UI available (service Session 0).
    if is_service_session() {
        return String::new();
    }

    let mut fallback = String::new();
    print!("{}", prompt);
    let _ = io::stdout().flush();
    let _ = io::stdin().read_line(&mut fallback);
    fallback.trim().to_string()
}

#[cfg(windows)]
fn is_service_session() -> bool {
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    unsafe {
        let mut session_id = 0u32;
        if ProcessIdToSessionId(GetCurrentProcessId(), &mut session_id).is_ok() {
            return session_id == 0;
        }
    }
    false
}

#[cfg(not(windows))]
fn is_service_session() -> bool {
    false
}

impl AgentConfig {
    pub fn load_existing() -> Option<Self> {
        let path = get_config_path();
        if !path.exists() {
            return None;
        }

        let mut file = File::open(&path).ok()?;
        let mut encrypted_data = Vec::new();
        file.read_to_end(&mut encrypted_data).ok()?;
        let decrypted_data = simple_crypt(&encrypted_data);
        serde_json::from_slice::<AgentConfig>(&decrypted_data).ok()
    }

    pub fn save(&self) -> bool {
        let path = get_config_path();
        let serialized = match serde_json::to_vec(self) {
            Ok(data) => data,
            Err(_) => return false,
        };
        let encrypted = simple_crypt(&serialized);
        if let Ok(mut file) = File::create(&path) {
            return file.write_all(&encrypted).is_ok();
        }
        false
    }

    pub fn clear_stored() {
        let path = get_config_path();
        let _ = fs::remove_file(path);
        println!("--> [CONFIG] Cleared stored credentials.");
    }

    pub async fn load_or_pair() -> Self {
        let args: Vec<String> = std::env::args().collect();
        let get_flag = |name: &str| -> Option<String> {
            args.iter()
                .position(|a| a == name)
                .and_then(|i| args.get(i + 1).cloned())
                .filter(|v| !v.trim().is_empty())
        };
        let force_repair = args.iter().any(|a| a == "--force-repair" || a == "--repair");
        let cli_gateway = get_flag("--gateway-url")
            .or_else(|| std::env::var("ZENVORA_GATEWAY_URL").ok());
        let cli_api = get_flag("--api-url")
            .or_else(|| std::env::var("ZENVORA_API_URL").ok());
        let has_cli_pair = get_flag("--pair-token")
            .or_else(|| std::env::var("ZENVORA_PAIR_TOKEN").ok())
            .is_some()
            && get_flag("--pair-user-id")
                .or_else(|| std::env::var("ZENVORA_PAIR_USER_ID").ok())
                .is_some();

        // Headless install: re-pair only when forced OR no agent.dat yet.
        // Re-launch from install dir must NOT hammer /pair again (that wedged Railway).
        let from_install = std::env::args()
            .any(|a| a == "--from-install-dir" || a == "--from-system32");
        if has_cli_pair && (force_repair || crate::connection_progress::is_headless()) {
            let existing = Self::load_existing();
            let should_http_pair = force_repair || existing.is_none() || !from_install;

            if should_http_pair {
                println!("--> [CONFIG] Headless/CLI pair flags detected — refreshing credentials + gateway");
                crate::connection_progress::step_msg(2, 8, crate::messages::M114_CREDENTIALS_REFRESH);
                match Self::pair_from_env_or_args().await {
                    Ok(config) => {
                        println!("--> [CONFIG] Using gateway {}", config.gateway_url);
                        return config;
                    }
                    Err(err) => {
                        println!("--> [CONFIG] Re-pair failed ({}), falling back to agent.dat", err);
                        crate::connection_progress::step_msg_detail(
                            2,
                            8,
                            crate::messages::M402_PAIR_FAILED,
                            &err,
                        );
                    }
                }
            } else if let Some(mut config) = existing {
                if let Some(gw) = cli_gateway.clone() {
                    if config.gateway_url != gw {
                        config.gateway_url = gw;
                        let _ = config.save();
                    }
                }
                println!(
                    "--> [CONFIG] Skipping re-pair (already provisioned) — using {}",
                    get_config_path().to_string_lossy()
                );
                crate::connection_progress::step_msg(2, 8, crate::messages::M103_CREDENTIALS_READY);
                return config;
            }
        }

        if let Some(mut config) = Self::load_existing() {
            let mut changed = false;
            if let Some(gw) = cli_gateway.clone() {
                if config.gateway_url != gw {
                    println!(
                        "--> [CONFIG] Overriding gateway\n    old: {}\n    new: {}",
                        config.gateway_url, gw
                    );
                    crate::connection_progress::step_msg_detail(
                        2,
                        8,
                        crate::messages::M114_CREDENTIALS_REFRESH,
                        &gw,
                    );
                    config.gateway_url = gw;
                    changed = true;
                }
            }
            if changed {
                let _ = config.save();
                crate::connection_progress::step_msg(2, 8, crate::messages::M115_GATEWAY_UPDATED);
            } else {
                println!(
                    "--> [CONFIG] Loaded existing paired credentials from {}",
                    get_config_path().to_string_lossy()
                );
                println!("--> [CONFIG] Gateway: {}", config.gateway_url);
            }

            // Still wire install telemetry when CLI tokens exist.
            if let (Some(token), Some(user_id)) = (
                get_flag("--pair-token").or_else(|| std::env::var("ZENVORA_PAIR_TOKEN").ok()),
                get_flag("--pair-user-id").or_else(|| std::env::var("ZENVORA_PAIR_USER_ID").ok()),
            ) {
                let api = cli_api.unwrap_or_else(|| {
                    config
                        .gateway_url
                        .replacen("wss://", "https://", 1)
                        .replacen("ws://", "http://", 1)
                        .trim_end_matches("/ws/gateway")
                        .to_string()
                });
                let session = get_flag("--install-session").unwrap_or_default();
                crate::install_telemetry::configure(
                    &api,
                    &config.gateway_url,
                    &token,
                    &user_id,
                    &session,
                );
            }

            return config;
        }

        // Non-interactive provision via CLI / PowerShell installer.
        if let Ok(config) = Self::pair_from_env_or_args().await {
            return config;
        }

        // Windows services cannot show InputBox dialogs (Session 0).
        if is_service_session() {
            crate::connection_status::report_failed(&crate::messages::M401_PAIR_REQUIRED.display());
            crate::connection_progress::finish_failed_msg(crate::messages::M401_PAIR_REQUIRED);
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                if let Some(config) = Self::load_existing() {
                    return config;
                }
            }
        }

        if crate::connection_progress::is_headless() {
            crate::connection_progress::finish_failed_msg(crate::messages::M401_PAIR_REQUIRED);
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                if let Some(config) = Self::load_existing() {
                    return config;
                }
            }
        }

        Self::pair_interactive().await
    }

    /// Pair using CLI flags / env vars (no GUI prompts).
    pub async fn pair_from_env_or_args() -> Result<Self, String> {
        let args: Vec<String> = std::env::args().collect();
        let get_flag = |name: &str| -> Option<String> {
            args.iter()
                .position(|a| a == name)
                .and_then(|i| args.get(i + 1).cloned())
                .filter(|v| !v.trim().is_empty())
        };

        let pairing_token = get_flag("--pair-token")
            .or_else(|| std::env::var("ZENVORA_PAIR_TOKEN").ok())
            .unwrap_or_default();
        let pairing_user_id = get_flag("--pair-user-id")
            .or_else(|| std::env::var("ZENVORA_PAIR_USER_ID").ok())
            .unwrap_or_default();

        if pairing_token.is_empty() || pairing_user_id.is_empty() {
            return Err("pair credentials missing".into());
        }

        let api_base_url = get_flag("--api-url")
            .or_else(|| std::env::var("ZENVORA_API_URL").ok())
            .unwrap_or_else(|| "https://www.zenvora.abdullahtahir.me".to_string());
        let gateway_override = get_flag("--gateway-url")
            .or_else(|| std::env::var("ZENVORA_GATEWAY_URL").ok());

        crate::connection_progress::step_msg(2, 6, crate::messages::M102_PAIRING);
        let mut config = Self::pair_with_credentials(
            &pairing_token,
            &pairing_user_id,
            &api_base_url,
        )
        .await?;
        if let Some(gw) = gateway_override {
            let api_public = !api_base_url.contains("localhost")
                && !api_base_url.contains("127.0.0.1");
            let gw_loopback = gw.contains("localhost") || gw.contains("127.0.0.1");
            if api_public && gw_loopback {
                println!(
                    "--> [CONFIG] Ignoring loopback --gateway-url ({}); keeping {}",
                    gw, config.gateway_url
                );
            } else {
                config.gateway_url = gw;
                let _ = config.save();
            }
        }
        crate::install_telemetry::configure(
            &api_base_url,
            &config.gateway_url,
            &pairing_token,
            &pairing_user_id,
            &std::env::args()
                .collect::<Vec<_>>()
                .windows(2)
                .find(|w| w[0] == "--install-session")
                .map(|w| w[1].clone())
                .unwrap_or_default(),
        );
        crate::connection_progress::step_msg(2, 6, crate::messages::M103_CREDENTIALS_READY);
        Ok(config)
    }

    async fn pair_with_credentials(
        pairing_token: &str,
        pairing_user_id: &str,
        api_base_url: &str,
    ) -> Result<Self, String> {
        let machine_name = hostname::get()
            .map(|h| h.to_string_lossy().to_uppercase())
            .unwrap_or_else(|_| "UNKNOWN-PC".to_string());

        let prefix = if cfg!(target_os = "macos") {
            "MAC-NODE"
        } else if cfg!(target_os = "linux") {
            "LINUX-NODE"
        } else {
            "WIN-NODE"
        };
        let device_id = std::env::var("ZENVORA_DEVICE_ID")
            .unwrap_or_else(|_| format!("{}-{}", prefix, machine_name));

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;

        let pair_endpoint = format!("{}/api/auth/agent/pair", api_base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "pairingToken": pairing_token,
            "pairingUserId": pairing_user_id,
            "deviceId": device_id,
            "hostname": machine_name
        });

        let mut last_err = String::from("pairing failed");
        for attempt in 1..=4u32 {
            let response = match client
                .post(&pair_endpoint)
                .header("User-Agent", "Zenvora-Agent/1.0")
                .header("Accept", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!("Network request failed: {}", e);
                    eprintln!(
                        "--> [CONFIG] Pair attempt {}/4 failed: {}",
                        attempt, last_err
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(2 * attempt as u64)).await;
                    continue;
                }
            };

            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|e| format!("Failed to read response body: {}", e));

            if !status.is_success() {
                last_err = format!("Server rejected pairing (HTTP {}). {}", status, text);
                // Auth/token errors — do not hammer
                if status.as_u16() == 401 || status.as_u16() == 403 || status.as_u16() == 404 {
                    return Err(last_err);
                }
                eprintln!(
                    "--> [CONFIG] Pair attempt {}/4 failed: {}",
                    attempt, last_err
                );
                tokio::time::sleep(std::time::Duration::from_secs(2 * attempt as u64)).await;
                continue;
            }

            let res_json: serde_json::Value = serde_json::from_str(&text)
                .map_err(|e| format!("Invalid server response: {} | body={}", e, text))?;

            let agent_token = res_json["agentToken"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Server response missing agentToken.".to_string())?
                .to_string();

            let mut gateway_url = res_json["gatewayUrl"]
                .as_str()
                .unwrap_or("wss://www.zenvora.abdullahtahir.me/ws/gateway")
                .to_string();

            if api_base_url.starts_with("https://") && gateway_url.starts_with("ws://") {
                gateway_url = gateway_url.replacen("ws://", "wss://", 1);
            }
            // Plain HTTP local servers cannot terminate TLS — force ws://
            if api_base_url.starts_with("http://") && gateway_url.starts_with("wss://") {
                gateway_url = gateway_url.replacen("wss://", "ws://", 1);
            }
            // Never keep a loopback gateway when we paired against a public API.
            let api_public = !api_base_url.contains("localhost")
                && !api_base_url.contains("127.0.0.1");
            let gw_loopback =
                gateway_url.contains("localhost") || gateway_url.contains("127.0.0.1");
            if api_public && gw_loopback {
                if let Ok(api) = url::Url::parse(api_base_url) {
                    let host = api.host_str().unwrap_or("www.zenvora.abdullahtahir.me");
                    let scheme = if api.scheme() == "https" { "wss" } else { "ws" };
                    gateway_url = format!("{}://{}/ws/gateway", scheme, host);
                    println!(
                        "--> [CONFIG] Rewrote loopback gateway from pair response → {}",
                        gateway_url
                    );
                }
            }

            let new_config = Self {
                gateway_url,
                device_id,
                agent_token,
            };

            if !new_config.save() {
                return Err("Pairing succeeded but failed to save encrypted credentials.".into());
            }

            return Ok(new_config);
        }

        Err(last_err)
    }

    pub async fn repair_credentials() -> Self {
        ui_notify::show_warning(
            "Zenvora Agent",
            "Connection authentication failed.\nPlease enter your pairing credentials again.",
        );
        Self::clear_stored();
        Self::pair_interactive().await
    }

    pub async fn pair_interactive() -> Self {
        loop {
            match Self::attempt_pairing().await {
                Ok(config) => {
                    let _ = crate::service::install_service();
                    let _ = crate::watchdog::ensure_supervisor_binary_exists();
                    ui_notify::show_info(
                        "Zenvora Agent",
                        &format!(
                            "Pairing successful!\nDevice: {}\nConnecting to gateway...",
                            config.device_id
                        ),
                    );
                    return config;
                }
                Err(message) => {
                    ui_notify::show_error(
                        "Zenvora Agent - Pairing Failed",
                        &format!(
                            "{}\n\nPlease check your Pair Token and Pair User ID, then try again.",
                            message
                        ),
                    );
                }
            }
        }
    }

    async fn attempt_pairing() -> Result<Self, String> {
        println!("--> [CONFIG] Machine is unpaired. Starting pairing sequence...");

        let pairing_token = request_token_input("Pair Token", "Enter Pair Token:");
        if pairing_token.is_empty() {
            return Err("Pair Token is required.".into());
        }

        let pairing_user_id = request_token_input("Pair User ID", "Enter Pair User ID:");
        if pairing_user_id.is_empty() {
            return Err("Pair User ID is required.".into());
        }

        let api_base_url = std::env::var("ZENVORA_API_URL")
            .unwrap_or_else(|_| "https://www.zenvora.abdullahtahir.me".to_string());

        Self::pair_with_credentials(&pairing_token, &pairing_user_id, &api_base_url).await.map(|config| {
            crate::install_telemetry::configure(
                &api_base_url,
                &config.gateway_url,
                &pairing_token,
                &pairing_user_id,
                "",
            );
            config
        })
    }
}
