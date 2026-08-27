use std::env;
use std::ffi::{OsStr, OsString};
use std::os::windows::process::CommandExt;
use std::panic;
use std::process::Command;
use std::sync::mpsc;
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;

use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
    ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    ServiceState as WinServiceState,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

const SERVICE_NAME: &str = "ZenvoraAgent";
const DISPLAY_NAME: &str = "Zenvora Agent Service";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SINGLETON_MUTEX_NAME: &str = "Global\\ZenvoraAgentSingleton";

/// Returns true if this process owns the singleton (only one agent worker should run).
/// Keep the returned handle alive for the process lifetime.
#[cfg(windows)]
pub fn acquire_singleton() -> Option<windows::Win32::Foundation::HANDLE> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows::Win32::System::Threading::CreateMutexW;

    let mut name: Vec<u16> = SINGLETON_MUTEX_NAME.encode_utf16().collect();
    name.push(0);
    unsafe {
        let handle = CreateMutexW(None, true, PCWSTR(name.as_ptr())).ok()?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            return None;
        }
        if handle.is_invalid() || handle == HANDLE::default() {
            return None;
        }
        Some(handle)
    }
}

/// True when another agent worker already holds the singleton mutex.
#[cfg(windows)]
pub fn agent_singleton_held() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};

    let mut name: Vec<u16> = SINGLETON_MUTEX_NAME.encode_utf16().collect();
    name.push(0);
    unsafe {
        match OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, PCWSTR(name.as_ptr())) {
            Ok(handle) => {
                let _ = CloseHandle(handle);
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
pub fn agent_singleton_held() -> bool {
    false
}

windows_service::define_windows_service!(ffi_service_main, service_main);

pub fn try_run_as_service() -> bool {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main).is_ok()
}

fn service_main(_arguments: Vec<OsString>) {
    let _ = run_service();
}

fn run_service() -> windows_service::Result<()> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let (tx, rx) = mpsc::channel::<()>();
    let shutdown_sender = Arc::new(Mutex::new(Some(tx)));
    let shutdown_sender_clone = shutdown_sender.clone();

    let status_handle = service_control_handler::register(SERVICE_NAME, move |event| {
        match event {
            ServiceControl::Stop => {
                stop_clone.store(true, Ordering::SeqCst);
                if let Some(sender) = shutdown_sender_clone.lock().unwrap().take() {
                    let _ = sender.send(());
                }
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    })?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    let stop_flag_for_thread = stop_flag.clone();
    thread::spawn(move || {
        // NEVER run the full agent in Session 0 — camera/screen capture always fail
        // there, and the Session-0 process steals the singleton so the interactive
        // user agent cannot start. Keep retrying interactive launch only.
        let exe = env::current_exe().ok();
        if crate::session_launch::is_session_zero() {
            if let Some(exe_path) = exe.as_ref() {
                let mut consecutive_fail = 0u32;
                loop {
                    if rx.try_recv().is_ok() || stop_flag_for_thread.load(Ordering::SeqCst) {
                        return;
                    }

                    match crate::session_launch::spawn_agent_in_active_user_session(
                        exe_path,
                        &stop_flag_for_thread,
                    ) {
                        Ok(()) => {
                            consecutive_fail = 0;
                            crate::connection_status::log(
                                "Interactive agent exited; will relaunch if service is still running.",
                            );
                            if stop_flag_for_thread.load(Ordering::SeqCst) {
                                return;
                            }
                            // Fast relaunch after taskkill / crash (was 3s).
                            thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                        Err(err) => {
                            consecutive_fail = consecutive_fail.saturating_add(1);
                            let wait = if consecutive_fail < 6 { 5 } else { 15 };
                            crate::connection_status::log(format!(
                                "Interactive session launch failed ({}); retrying in {}s (no Session-0 fallback — camera/screen require a logged-in user).",
                                err, wait
                            ));
                            for _ in 0..(wait * 2) {
                                if rx.try_recv().is_ok()
                                    || stop_flag_for_thread.load(Ordering::SeqCst)
                                {
                                    return;
                                }
                                thread::sleep(Duration::from_millis(500));
                            }
                            continue;
                        }
                    }
                }
            }
            crate::connection_status::log(
                "Service has no executable path; cannot launch interactive agent.",
            );
            return;
        }

        // Non-Session-0 service context (unusual) — run agent in-process.
        loop {
            if rx.try_recv().is_ok() || stop_flag_for_thread.load(Ordering::SeqCst) {
                break;
            }

            let stop_flag_for_run = stop_flag_for_thread.clone();
            let result = panic::catch_unwind(move || {
                let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
                runtime.block_on(async move {
                    crate::run_agent_with_stop(Some(stop_flag_for_run)).await;
                });
            });

            match result {
                Ok(_) => break,
                Err(_) => thread::sleep(Duration::from_secs(5)),
            }
        }
    });

    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(500));
    }

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StopPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 1,
        wait_hint: Duration::from_secs(10),
        process_id: None,
    })?;

    Ok(())
}

fn format_win_error(err: impl std::fmt::Display) -> String {
    format!("{}", err)
}

fn open_manager(access: ServiceManagerAccess) -> Result<ServiceManager, String> {
    ServiceManager::local_computer(None::<&str>, access).map_err(format_win_error)
}

fn open_service(access: ServiceAccess) -> Result<windows_service::service::Service, String> {
    let manager = open_manager(ServiceManagerAccess::CONNECT)?;
    manager
        .open_service(SERVICE_NAME, access)
        .map_err(format_win_error)
}

pub fn service_exists() -> bool {
    open_service(ServiceAccess::QUERY_STATUS).is_ok()
}

pub fn service_state() -> String {
    match open_service(ServiceAccess::QUERY_STATUS) {
        Ok(service) => match service.query_status() {
            Ok(status) => format!("{:?}", status.current_state),
            Err(err) => err.to_string(),
        },
        Err(err) => err,
    }
}

pub fn service_running() -> bool {
    match open_service(ServiceAccess::QUERY_STATUS) {
        Ok(service) => service
            .query_status()
            .map(|status| status.current_state == WinServiceState::Running)
            .unwrap_or(false),
        Err(_) => false,
    }
}

fn sc_create(exe: &str) -> Result<(), String> {
    // sc.exe needs: create Name binPath= "path" start= auto DisplayName= "Name"
    // Spaces after '=' are required by the sc parser.
    let output = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "create",
            SERVICE_NAME,
            &format!("binPath= \"{}\"", exe),
            "start=",
            "auto",
            "DisplayName=",
            DISPLAY_NAME,
            "obj=",
            "LocalSystem",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if output.status.success() || combined.contains("SUCCESS") {
        return Ok(());
    }

    // 1073 = already exists
    if combined.contains("1073") || combined.to_lowercase().contains("already exists") {
        return Ok(());
    }

    Err(combined.trim().to_string())
}

fn sc_config(exe: &str) -> Result<(), String> {
    let output = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "config",
            SERVICE_NAME,
            &format!("binPath= \"{}\"", exe),
            "start=",
            "auto",
            "obj=",
            "LocalSystem",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if output.status.success() || combined.contains("SUCCESS") {
        Ok(())
    } else {
        Err(combined.trim().to_string())
    }
}

fn sc_start() -> Result<(), String> {
    let output = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["start", SERVICE_NAME])
        .output()
        .map_err(|e| e.to_string())?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if output.status.success()
        || combined.contains("START_PENDING")
        || combined.contains("RUNNING")
        || combined.contains("1056")
    {
        return Ok(());
    }

    Err(combined.trim().to_string())
}

fn create_via_api(exe: &std::path::Path) -> Result<(), String> {
    let manager = open_manager(
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;

    let service_info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe.to_path_buf(),
        launch_arguments: vec![],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    };

    manager
        .create_service(
            &service_info,
            ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::QUERY_STATUS,
        )
        .map_err(format_win_error)?;

    Ok(())
}

/// Install or update the service. Does NOT delete existing service (avoids MARKED_FOR_DELETE).
pub fn install_service() -> Result<(), String> {
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy().to_string();

    if service_exists() {
        // Prefer API config if available, then fall back to sc.exe
        if let Ok(service) = open_service(ServiceAccess::CHANGE_CONFIG | ServiceAccess::QUERY_STATUS)
        {
            let info = ServiceInfo {
                name: OsString::from(SERVICE_NAME),
                display_name: OsString::from(DISPLAY_NAME),
                service_type: ServiceType::OWN_PROCESS,
                start_type: ServiceStartType::AutoStart,
                error_control: ServiceErrorControl::Normal,
                executable_path: exe.clone(),
                launch_arguments: vec![],
                dependencies: vec![],
                account_name: None,
                account_password: None,
            };
            if service.change_config(&info).is_ok() {
                let _ = service;
                configure_service_recovery();
                return Ok(());
            }
        }

        sc_config(&exe_str)?;
        configure_service_recovery();
        return Ok(());
    }

    // Try WinAPI create first, then sc.exe
    match create_via_api(&exe) {
        Ok(()) => {
            configure_service_recovery();
            Ok(())
        }
        Err(api_err) => match sc_create(&exe_str) {
            Ok(()) => {
                configure_service_recovery();
                Ok(())
            }
            Err(sc_err) => Err(format!("API: {} | sc.exe: {}", api_err, sc_err)),
        },
    }
}

/// SCM auto-restart if the service process itself dies (complements interactive-agent relaunch loop).
fn configure_service_recovery() {
    let _ = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "failure",
            SERVICE_NAME,
            "reset=",
            "86400",
            "actions=",
            "restart/3000/restart/5000/restart/10000",
        ])
        .output();
    let _ = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["failureflag", SERVICE_NAME, "flag=", "1"])
        .output();
}

pub fn start_service() -> Result<(), String> {
    if service_running() {
        return Ok(());
    }

    // Try WinAPI first
    if let Ok(service) = open_service(ServiceAccess::START) {
        match service.start(&[] as &[&OsStr]) {
            Ok(_) => return Ok(()),
            Err(err) => {
                let message = err.to_string();
                if message.contains("1056") || service_running() {
                    return Ok(());
                }
                // Fall through to sc.exe
            }
        }
    }

    sc_start()
}

pub fn stop_service() {
    if let Ok(service) = open_service(ServiceAccess::STOP | ServiceAccess::QUERY_STATUS) {
        if let Ok(status) = service.query_status() {
            if status.current_state != WinServiceState::Stopped {
                let _ = service.stop();
            }
        }
    }

    let _ = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["stop", SERVICE_NAME])
        .output();
}

pub fn wait_for_service_running(timeout_secs: u64) -> bool {
    for _ in 0..timeout_secs {
        if service_running() {
            return true;
        }
        thread::sleep(Duration::from_secs(1));
    }
    service_running()
}

pub fn restart_service() -> Result<(), String> {
    stop_service();
    thread::sleep(Duration::from_secs(3));
    start_service()?;
    if wait_for_service_running(25) {
        Ok(())
    } else {
        Err(format!("Service state after restart: {}", service_state()))
    }
}

pub fn uninstall_service() {
    stop_service();
    thread::sleep(Duration::from_secs(2));
    if let Ok(service) = open_service(ServiceAccess::DELETE) {
        let _ = service.delete();
    }
    let _ = Command::new("sc.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["delete", SERVICE_NAME])
        .output();
}

/// Run agent as a detached background process (not a Windows service).
/// Uses `--supervise-agent` so a taskkill of the worker is followed by an automatic relaunch.
pub fn spawn_background_agent(exe: &str) -> Result<(), String> {
    #[cfg(windows)]
    if agent_singleton_held() {
        return Ok(());
    }
    Command::new(exe)
        .arg("--supervise-agent")
        .creation_flags(CREATE_NO_WINDOW | 0x00000008) // DETACHED_PROCESS
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}
