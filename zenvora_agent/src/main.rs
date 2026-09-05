// Windowless in release. For debug terminal: leave this commented, or use --console.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
mod activity;
mod activity_monitor;
mod camera_worker;
mod config;
mod system;
mod audio;
mod screen;
mod agent;
mod commands;
mod screen_commands;
mod file_commands;
mod router;
mod network;
mod windows_controls;
mod com_runtime;
mod protocol;
mod sync_cursor;
mod control_channel;
mod notifications;
mod browser_history;
mod app_history;
mod history_commands;
mod heal_ai;
mod shell_commands;
mod service;
mod ui_notify;
mod input;
mod connection_status;
mod connection_progress;
mod agent_update;
mod install_telemetry;
mod session_launch;
mod paths;
pub mod platform;
pub mod watchdog;
pub mod ai_verifier;
pub mod media_channels;
pub mod screen_abr;
pub mod messages;
use std::env;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
#[cfg(windows)]
use std::thread;

#[cfg(windows)]
fn attach_parent_console() {
    use windows::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS).is_err() {
            let _ = AllocConsole();
        }
    }
}

/// Make the process per-monitor-DPI-aware so Win32 pointer APIs
/// (`GetCursorInfo` / `GetCursorPos`) report the SAME physical-pixel coordinate
/// space that xcap captures in. Without this, on any display with scaling
/// (125% / 150% / 200%) the cursor is reported in logical pixels and lands in
/// the wrong place on the streamed frame. Must run before any window/DC work.
#[cfg(windows)]
fn ensure_dpi_awareness() {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe {
        // Ignore the result: it fails harmlessly if awareness was already set
        // (e.g. via an embedded manifest) — either way we end up DPI-aware.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

#[cfg(not(windows))]
fn ensure_dpi_awareness() {}

pub async fn run_agent() {
    run_agent_with_stop(None).await;
}

pub async fn run_agent_with_stop(stop_flag: Option<Arc<AtomicBool>>) {
    // Align our coordinate space with the capture backend before anything else.
    ensure_dpi_awareness();

    // Session 0 (Windows service) cannot capture camera/screen of the logged-in user.
    // Refuse here so we never steal the singleton from an interactive agent.
    #[cfg(windows)]
    if session_launch::is_session_zero() {
        connection_status::log(
            "Refusing full agent in Session 0 (camera/screen unavailable). Service must launch into the interactive user session.",
        );
        while stop_flag
            .as_ref()
            .map(|f| !f.load(std::sync::atomic::Ordering::SeqCst))
            .unwrap_or(false)
        {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        return;
    }

    #[cfg(windows)]
    let _singleton = {
        match service::acquire_singleton() {
            Some(handle) => handle,
            None => {
                eprintln!(
                    "--> [AGENT] Another ZenvoraAgent is already running — exiting duplicate worker"
                );
                connection_status::log(
                    "Duplicate agent process detected — exiting (keeps gateway/media stable)",
                );
                return;
            }
        }
    };

    connection_status::log("Agent worker starting");
    com_runtime::init_process_com();

    let notifier = notifications::global_notifier();
    notifier.start_listening();

    // Dual-process self-healing supervisor: launch and monitor companion watchdog
    watchdog::start_agent_watchdog_thread(stop_flag.clone());

    let mut config = config::AgentConfig::load_or_pair().await;
    connection_status::log(format!(
        "Credentials ready for device={}",
        config.device_id
    ));
    let mut agent_state = agent::AgentState::new();

    // Always-on control plane (WS-first ZV framing).
    let control_config = config.clone();
    let control_stop = stop_flag.clone();
    tokio::spawn(async move {
        control_channel::run_control_loop(control_config, control_stop).await;
    });

    // Dedicated media channels — keep heavy frames off /ws/gateway.
    media_channels::init_media_transport_from_env();
    let media_config = Arc::new(config.clone());
    let screen_media = media_channels::spawn_media_channel(
        Arc::clone(&media_config),
        "screen".to_string(),
        stop_flag.clone(),
    );
    let camera_media = media_channels::spawn_media_channel(
        Arc::clone(&media_config),
        "camera".to_string(),
        stop_flag.clone(),
    );
    agent_state.screen_media_tx = Some(screen_media.tx);
    agent_state.camera_media_tx = Some(camera_media.tx);

    // Media / command WebSocket (shell, files, light telemetry).
    network::run_network_loop(&mut agent_state, &mut config, stop_flag).await;
}

#[cfg(windows)]
fn install_dir() -> PathBuf {
    paths::agent_dir()
}

#[cfg(windows)]
fn is_in_install_dir(path: &Path) -> bool {
    path.parent()
        .map(|parent| parent == install_dir().as_path())
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_process_elevated() -> bool {
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret,
        )
        .is_ok();
        let _ = windows::Win32::Foundation::CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

/// Relaunch this exe with a UAC elevation prompt (asInvoker → runas).
#[cfg(windows)]
fn relaunch_elevated_and_exit() -> ! {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, w};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = env::current_exe().expect("current exe");
    let mut exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let args: Vec<String> = env::args().skip(1).collect();
    let mut params = args.join(" ");
    if !params.contains("--from-install-dir") && !params.contains("--elevated-relaunch") {
        if !params.is_empty() {
            params.push(' ');
        }
        params.push_str("--elevated-relaunch");
    }
    let mut params_wide: Vec<u16> = params.encode_utf16().chain(std::iter::once(0)).collect();

    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            PCWSTR(exe_wide.as_mut_ptr()),
            PCWSTR(params_wide.as_mut_ptr()),
            None,
            SW_SHOWNORMAL,
        )
    };

    if (result.0 as usize) <= 32 {
        ui_notify::show_blocking_error(
            "Zenvora",
            &messages::M701_ADMIN_REQUIRED.display(),
        );
    }
    std::process::exit(0);
}

/// Install under ProgramData\Zenvora (never System32 — that triggers Defender ML).
#[cfg(windows)]
fn relocate_to_install_dir() -> ! {
    let current_exe = env::current_exe().expect("current exe");
    let target_path = paths::agent_exe_path();
    let _ = fs::create_dir_all(paths::agent_dir());

    // Running service locks ZenvoraAgent.exe — stop before overwrite.
    if service::service_exists() {
        service::stop_service();
        thread::sleep(std::time::Duration::from_millis(800));
    }

    if let Err(err) = fs::copy(&current_exe, &target_path) {
        let denied = err.raw_os_error() == Some(5) || err.kind() == std::io::ErrorKind::PermissionDenied;
        if denied && !is_process_elevated() {
            relaunch_elevated_and_exit();
        }
        // Elevated but still denied — often a leftover lock; one more stop+retry.
        if denied {
            service::stop_service();
            thread::sleep(std::time::Duration::from_millis(1200));
            if fs::copy(&current_exe, &target_path).is_ok() {
                // fall through to launch
            } else {
                ui_notify::show_blocking_error(
                    "Zenvora",
                    &messages::M702_INSTALL_DENIED.display(),
                );
                std::process::exit(1);
            }
        } else {
            ui_notify::show_blocking_error(
                "Zenvora",
                &messages::M703_INSTALL_COPY_FAILED.with_detail(&err.to_string()),
            );
            std::process::exit(1);
        }
    }

    let mut args: Vec<String> = env::args().skip(1).collect();
    if !args.iter().any(|arg| arg == "--from-install-dir") {
        args.push("--from-install-dir".to_string());
    }
    args.retain(|a| a != "--from-system32" && a != "--elevated-relaunch");

    if Command::new(&target_path).args(&args).spawn().is_err() {
        ui_notify::show_blocking_error(
            "Zenvora",
            &messages::M704_LAUNCH_FAILED.display(),
        );
        std::process::exit(1);
    }

    std::process::exit(0);
}

#[cfg(windows)]
fn wait_for_connection_report(timeout_secs: u64) -> Option<String> {
    let ticks = timeout_secs.saturating_mul(2); // 500ms polls
    for i in 0..ticks {
        if let Some(status) = connection_status::read_status() {
            if connection_status::is_final_status(&status) {
                return Some(status);
            }
            if status.starts_with("connecting|") && i % 4 == 0 {
                connection_progress::step(
                    6,
                    8,
                    &messages::M109_HANDSHAKE.with_detail(&format!("{}s", i / 2)),
                    "running",
                );
            }
        }
        thread::sleep(std::time::Duration::from_millis(500));
    }
    connection_status::read_status().filter(|s| connection_status::is_final_status(s))
}

#[cfg(windows)]
fn show_connection_report(status: &str) {
    if let Some(rest) = status.strip_prefix("connected|") {
        let parts: Vec<&str> = rest.splitn(2, '|').collect();
        let device = parts.first().copied().unwrap_or("device");
        let gateway = parts.get(1).copied().unwrap_or("gateway");
        connection_progress::step_msg(7, 8, messages::M110_GATEWAY_OK);
        connection_progress::finish_success(device, gateway);
        if !connection_progress::is_headless() {
            connection_progress::wait_gui_closed();
        }
        return;
    }

    if let Some(reason) = status.strip_prefix("failed|") {
        connection_progress::step(7, 8, &messages::M501_CONNECT_FAILED.with_detail(reason), "fail");
        connection_progress::finish_failed_msg_detail(messages::M501_CONNECT_FAILED, reason);
        if !connection_progress::is_headless() {
            connection_progress::wait_gui_closed();
        }
    }
}

#[cfg(windows)]
fn ensure_agent_running() -> Result<(), String> {
    let exe = env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())?;

    connection_progress::step_msg(4, 8, messages::M104_SERVICE_INSTALLING);
    let mut service_ok = false;
    match service::install_service() {
        Ok(()) => {
            let started = if service::service_running() {
                Ok(())
            } else {
                service::start_service().and_then(|_| {
                    if service::wait_for_service_running(12) {
                        Ok(())
                    } else {
                        Err(format!("Service state: {}", service::service_state()))
                    }
                })
            };
            match started {
                Ok(()) => {
                    connection_progress::step_msg(3, 8, messages::M116_SERVICE_WORKER_OK);
                    connection_progress::step_msg(4, 8, messages::M105_SERVICE_RUNNING);
                    service_ok = true;
                }
                Err(err) => connection_progress::step_msg_detail(
                    4,
                    8,
                    messages::M111_SERVICE_FALLBACK,
                    &err,
                ),
            }
        }
        Err(err) => {
            connection_progress::step_msg_detail(4, 8, messages::M111_SERVICE_FALLBACK, &err);
        }
    }

    // One permanent worker only: if the Windows service is running it already
    // launches the interactive --run-agent. Do NOT also spawn a second worker —
    // two agents fight over gateway/media and show as duplicate Task Manager entries.
    if service_ok {
        connection_progress::step_msg(3, 8, messages::M107_WORKER_STARTED);
        return Ok(());
    }

    connection_progress::step_msg(3, 8, messages::M106_WORKER_STARTING);
    if service::agent_singleton_held() {
        connection_progress::step_msg(3, 8, messages::M107_WORKER_STARTED);
        return Ok(());
    }
    match service::spawn_background_agent(&exe) {
        Ok(()) => {
            connection_progress::step_msg(3, 8, messages::M107_WORKER_STARTED);
            Ok(())
        }
        Err(err) => {
            connection_progress::step_msg_detail(3, 8, messages::M706_WORKER_LAUNCH_FAILED, &err);
            Err(messages::M706_WORKER_LAUNCH_FAILED.with_detail(&err))
        }
    }
}

#[cfg(windows)]
fn bootstrap_service_and_report() {
    connection_status::mark_bootstrap_waiting();
    connection_status::reset_connect_report();
    connection_progress::start_gui();
    connection_progress::step_msg(1, 8, messages::M101_PREPARING);

    if let Err(err) = ensure_agent_running() {
        connection_progress::step(4, 8, &err, "fail");
        connection_progress::finish_failed(&err);
        if !connection_progress::is_headless() {
            connection_progress::wait_gui_closed();
        }
        return;
    }

    connection_progress::step_msg(5, 8, messages::M108_CONNECTING);
    connection_progress::step_msg(6, 8, messages::M109_HANDSHAKE);

    if let Some(status) = wait_for_connection_report(60) {
        show_connection_report(&status);
        return;
    }

    if let Some(status) = connection_status::read_status() {
        if connection_status::is_final_status(&status) {
            show_connection_report(&status);
            return;
        }
    }

    connection_progress::step_msg(8, 8, messages::M502_HANDSHAKE_TIMEOUT);
    connection_progress::finish_warning_msg(messages::M502_HANDSHAKE_TIMEOUT);
    if !connection_progress::is_headless() {
        connection_progress::wait_gui_closed();
    }
}

#[cfg(not(windows))]
fn relocate_to_system32() -> ! {
    std::process::exit(0);
}

fn run_async_main(args: &[String]) {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");

    let headless = args.iter().any(|a| a == "--headless" || a == "--provision");
    connection_progress::set_headless(headless);
    install_telemetry::configure_from_args(args);

    #[cfg(windows)]
    if headless || args.iter().any(|a| a == "--console") {
        attach_parent_console();
    }

    if let Some(pos) = args.iter().position(|a| a == "--watchdog-supervisor") {
        if args.len() > pos + 2 {
            let pid = args[pos + 1].parse::<u32>().unwrap_or(0);
            let exe = PathBuf::from(&args[pos + 2]);
            watchdog::run_supervisor_loop(pid, exe);
            return;
        }
    }

    if args.iter().any(|a| a == "--run-agent") {
        connection_status::reset_connect_report();
        runtime.block_on(run_agent());
        return;
    }

    if args.iter().any(|a| a == "--supervise-agent") {
        let exe = match env::current_exe() {
            Ok(p) => p,
            Err(_) => return,
        };
        loop {
            let mut child = Command::new(&exe);
            child.arg("--run-agent");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                child.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            match child.status() {
                Ok(_) => {
                    connection_status::log(
                        "Supervised agent exited; relaunching in 1s…",
                    );
                }
                Err(err) => {
                    connection_status::log(format!(
                        "Supervised agent launch failed ({err}); retrying in 3s…"
                    ));
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    continue;
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }

    if args.iter().any(|a| a == "--console") {
        connection_status::clear_status();
        connection_progress::set_headless(true);
        runtime.block_on(run_agent());
        return;
    }

    if args.len() > 1 {
        match args[1].as_str() {
            "install" => {
                #[cfg(windows)]
                {
                    if let Ok(current_exe) = env::current_exe() {
                        if !is_in_install_dir(&current_exe) {
                            relocate_to_install_dir();
                        }
                    }
                    // Ensure credentials exist before service start (esp. PowerShell install).
                    runtime.block_on(async {
                        connection_progress::step(2, 8, "Pairing / loading credentials...", "running");
                        let _ = config::AgentConfig::load_or_pair().await;
                        connection_progress::step(2, 8, "Credentials ready", "ok");
                    });
                    bootstrap_service_and_report();
                }
                #[cfg(not(windows))]
                {
                    runtime.block_on(async {
                        println!("[INSTALL] Pairing / checking credentials...");
                        let _ = config::AgentConfig::load_or_pair().await;
                        println!("[INSTALL] Credentials ready.");
                    });
                    #[cfg(target_os = "macos")]
                    {
                        println!("[INSTALL] Prompting for macOS System Permissions (Screen Recording & Accessibility)...");
                        platform::request_screen_capture_permission();
                        platform::request_accessibility_permission();
                    }
                    println!("[INSTALL] Installing background service (launchd/systemd)...");
                    match service::install_service() {
                        Ok(()) => {
                            println!("[OK] Background service installed and started.");
                        }
                        Err(e) => {
                            eprintln!("[WARN] Service install fallback ({e}). Spawning background supervisor...");
                            if let Ok(exe) = env::current_exe() {
                                let _ = service::spawn_background_agent(&exe.to_string_lossy());
                            }
                        }
                    }
                    let _ = watchdog::ensure_supervisor_binary_exists();
                }
                return;
            }
            "uninstall" => {
                service::uninstall_service();
                if headless {
                    println!("[OK] Service removed.");
                } else {
                    ui_notify::show_blocking_info("Zenvora", &messages::M113_SERVICE_REMOVED.display());
                }
                return;
            }
            "start" => {
                if let Err(err) = service::start_service() {
                    if headless {
                        eprintln!("{}", messages::M705_SERVICE_START_FAILED.with_detail(&err));
                    } else {
                        ui_notify::show_blocking_error(
                            "Zenvora",
                            &messages::M705_SERVICE_START_FAILED.with_detail(&err),
                        );
                    }
                } else if headless {
                    println!("[OK] {}", messages::M105_SERVICE_RUNNING.display());
                }
                return;
            }
            "stop" => {
                service::stop_service();
                if headless {
                    println!("[OK] Service stopped.");
                }
                return;
            }
            "restart" => {
                if let Err(err) = service::restart_service() {
                    if headless {
                        eprintln!("{}", messages::M707_SERVICE_OP_FAILED.with_detail(&err));
                    } else {
                        ui_notify::show_blocking_error(
                            "Zenvora",
                            &messages::M707_SERVICE_OP_FAILED.with_detail(&err),
                        );
                    }
                } else if headless {
                    println!("[OK] Service restarted.");
                }
                return;
            }
            "--from-system32" | "--from-install-dir" => {}
            _ => {}
        }
    }

    // PowerShell / one-shot provision: pair + install + connect, all status in terminal.
    if headless {
        #[cfg(windows)]
        {
            connection_progress::step_msg(1, 8, messages::M100_PROVISION_STARTED);
            runtime.block_on(async {
                connection_progress::step_msg(2, 8, messages::M102_PAIRING);
                let _ = config::AgentConfig::load_or_pair().await;
                connection_progress::step_msg(2, 8, messages::M103_CREDENTIALS_READY);
            });
            if let Ok(current_exe) = env::current_exe() {
                if !is_in_install_dir(&current_exe) {
                    let target = paths::agent_exe_path();
                    let _ = fs::create_dir_all(paths::agent_dir());
                    if fs::copy(&current_exe, &target).is_ok() {
                        let mut child_args: Vec<String> = env::args().skip(1).collect();
                        child_args.retain(|a| a != "--from-system32");
                        if !child_args.iter().any(|a| a == "--from-install-dir") {
                            child_args.push("--from-install-dir".into());
                        }
                        let status = Command::new(&target).args(&child_args).status();
                        std::process::exit(status.map(|s| s.code().unwrap_or(1)).unwrap_or(1));
                    }
                }
            }
            bootstrap_service_and_report();
        }
        return;
    }

    #[cfg(windows)]
    if let Ok(current_exe) = env::current_exe() {
        if !is_in_install_dir(&current_exe) {
            relocate_to_install_dir();
        }
    }

    #[cfg(windows)]
    {
        // Manual double-click: GUI progress window.
        runtime.block_on(async {
            let _ = config::AgentConfig::load_or_pair().await;
        });
        bootstrap_service_and_report();
        return;
    }

    #[cfg(not(windows))]
    runtime.block_on(run_agent());
}

fn main() {
    let args: Vec<String> = env::args().collect();

    #[cfg(windows)]
    let has_cli_action = args.len() > 1
        && matches!(
            args[1].as_str(),
            "install"
                | "uninstall"
                | "start"
                | "stop"
                | "restart"
                | "--console"
                | "--run-agent"
                | "--supervise-agent"
                | "--from-system32"
                | "--from-install-dir"
                | "--elevated-relaunch"
                | "--headless"
                | "--provision"
                | "--watchdog-supervisor"
        )
        || args.iter().any(|a| {
            matches!(
                a.as_str(),
                "--headless"
                    | "--provision"
                    | "--pair-token"
                    | "--run-agent"
                    | "--supervise-agent"
                    | "--watchdog-supervisor"
                    | "--console"
            )
        });

    #[cfg(windows)]
    if !has_cli_action && service::try_run_as_service() {
        return;
    }

    run_async_main(&args);
}
