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
mod shell_commands;
mod service;
mod ui_notify;
mod input;
mod connection_status;
mod connection_progress;
mod install_telemetry;
mod session_launch;
mod paths;
pub mod media_channels;
pub mod screen_abr;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
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

pub async fn run_agent() {
    run_agent_with_stop(None).await;
}

pub async fn run_agent_with_stop(stop_flag: Option<Arc<AtomicBool>>) {
    connection_status::log("Agent worker starting");
    com_runtime::init_process_com();

    let notifier = notifications::global_notifier();
    notifier.start_listening();

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

/// Install under ProgramData\Zenvora (never System32 — that triggers Defender ML).
#[cfg(windows)]
fn relocate_to_install_dir() -> ! {
    let current_exe = env::current_exe().expect("current exe");
    let target_path = paths::agent_exe_path();
    let _ = fs::create_dir_all(paths::agent_dir());

    if let Err(err) = fs::copy(&current_exe, &target_path) {
        ui_notify::show_blocking_error(
            "Zenvora Agent",
            &format!("Failed to install agent to {}:\n{}", target_path.display(), err),
        );
        std::process::exit(1);
    }

    let mut args: Vec<String> = env::args().skip(1).collect();
    if !args.iter().any(|arg| arg == "--from-install-dir") {
        args.push("--from-install-dir".to_string());
    }
    // Keep legacy flag accepted for older scripts.
    args.retain(|a| a != "--from-system32");

    if Command::new(&target_path).args(&args).spawn().is_err() {
        ui_notify::show_blocking_error(
            "Zenvora Agent",
            "Failed to launch agent from install directory.",
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
                    &format!("Waiting for gateway… {}s", i / 2),
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
        connection_progress::step(7, 8, "Gateway connection established", "ok");
        connection_progress::finish_success(device, gateway);
        if !connection_progress::is_headless() {
            connection_progress::wait_gui_closed();
        }
        return;
    }

    if let Some(reason) = status.strip_prefix("failed|") {
        connection_progress::step(7, 8, reason, "fail");
        connection_progress::finish_failed(reason);
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

    // Fast path first — do not block on SCM.
    connection_progress::step(3, 8, "Starting agent worker (fast path)...", "running");
    if let Err(err) = service::spawn_background_agent(&exe) {
        connection_progress::step(3, 8, &format!("Fast launch failed: {}", err), "warn");
    } else {
        connection_progress::step(3, 8, "Agent worker launched", "ok");
    }

    connection_progress::step(4, 8, "Installing Windows service for auto-start...", "running");
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
                Ok(()) => connection_progress::step(4, 8, "Windows service running", "ok"),
                Err(err) => connection_progress::step(
                    4,
                    8,
                    &format!("Service optional — agent already running ({})", err),
                    "warn",
                ),
            }
            Ok(())
        }
        Err(err) => {
            connection_progress::step(
                4,
                8,
                &format!("Service install skipped ({}) — using background agent", err),
                "warn",
            );
            Ok(())
        }
    }
}

#[cfg(windows)]
fn bootstrap_service_and_report() {
    connection_status::mark_bootstrap_waiting();
    connection_status::reset_connect_report();
    connection_progress::start_gui();
    connection_progress::step(1, 8, "Preparing agent...", "ok");

    if let Err(err) = ensure_agent_running() {
        connection_progress::step(4, 8, &err, "fail");
        connection_progress::finish_failed(&err);
        if !connection_progress::is_headless() {
            connection_progress::wait_gui_closed();
        }
        return;
    }

    connection_progress::step(5, 8, "Connecting to gateway WebSocket...", "running");
    connection_progress::step(6, 8, "Waiting for handshake (max ~60s)...", "running");

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

    let warn = "Still connecting in background. Watch live logs on Pair Device modal — agent keeps retrying.";
    connection_progress::step(8, 8, warn, "warn");
    connection_progress::finish_warning(warn);
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

    if args.iter().any(|a| a == "--run-agent") {
        connection_status::reset_connect_report();
        runtime.block_on(run_agent());
        return;
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
                return;
            }
            "uninstall" => {
                service::uninstall_service();
                if headless {
                    println!("[OK] Service removed.");
                } else {
                    ui_notify::show_blocking_info("Zenvora Agent", "Service removed.");
                }
                return;
            }
            "start" => {
                if let Err(err) = service::start_service() {
                    if headless {
                        eprintln!("[FAIL] {}", err);
                    } else {
                        ui_notify::show_blocking_error("Zenvora Agent", &err);
                    }
                } else if headless {
                    println!("[OK] Service started.");
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
                        eprintln!("[FAIL] {}", err);
                    } else {
                        ui_notify::show_blocking_error("Zenvora Agent", &err);
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
            connection_progress::step(1, 8, "Headless provision started", "running");
            runtime.block_on(async {
                connection_progress::step(2, 8, "Pairing / loading credentials...", "running");
                let _ = config::AgentConfig::load_or_pair().await;
                connection_progress::step(2, 8, "Credentials ready (agent.dat)", "ok");
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
                | "--from-system32"
                | "--from-install-dir"
                | "--headless"
                | "--provision"
        )
        || args.iter().any(|a| {
            matches!(
                a.as_str(),
                "--headless" | "--provision" | "--pair-token" | "--run-agent" | "--console"
            )
        });

    #[cfg(windows)]
    if !has_cli_action && service::try_run_as_service() {
        return;
    }

    run_async_main(&args);
}
