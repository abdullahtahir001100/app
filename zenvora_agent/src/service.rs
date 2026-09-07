#[cfg(windows)]
mod win {
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

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}{}", stdout, stderr);

        if output.status.success() || combined.contains("SUCCESS") {
            return Ok(());
        }

        Err(combined.trim().to_string())
    }

    fn sc_start() -> Result<(), String> {
        let output = Command::new("sc.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["start", SERVICE_NAME])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}{}", stdout, stderr);

        if output.status.success() || combined.contains("1056") || service_running() {
            return Ok(());
        }

        Err(combined.trim().to_string())
    }

    fn create_via_api(exe: &OsStr) -> Result<(), String> {
        let manager = open_manager(ServiceManagerAccess::CREATE_SERVICE)?;
        let info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe.to_os_string(),
            launch_arguments: Vec::new(),
            dependencies: Vec::new(),
            account_name: None,
            account_password: None,
        };

        match manager.create_service(&info, ServiceAccess::empty()) {
            Ok(_) => Ok(()),
            Err(err) => {
                let message = err.to_string();
                if message.contains("1073") {
                    if let Ok(service) = open_service(ServiceAccess::CHANGE_CONFIG) {
                        let _ = service.set_config(&info);
                    }
                    Ok(())
                } else {
                    Err(message)
                }
            }
        }
    }

    pub fn install_service() -> Result<(), String> {
        let exe = env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy();

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

        if let Ok(service) = open_service(ServiceAccess::START) {
            match service.start(&[] as &[&OsStr]) {
                Ok(_) => return Ok(()),
                Err(err) => {
                    let message = err.to_string();
                    if message.contains("1056") || service_running() {
                        return Ok(());
                    }
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

    pub fn spawn_background_agent(exe: &str) -> Result<(), String> {
        if agent_singleton_held() {
            return Ok(());
        }
        Command::new(exe)
            .arg("--supervise-agent")
            .creation_flags(CREATE_NO_WINDOW | 0x00000008)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string())
    }
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
mod unix {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    pub fn acquire_singleton() -> Option<u32> {
        Some(std::process::id())
    }

    pub fn agent_singleton_held() -> bool {
        false
    }

    pub fn try_run_as_service() -> bool {
        false
    }

    #[cfg(target_os = "macos")]
    fn plist_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("Library/LaunchAgents/com.zenvora.agent.plist")
    }

    #[cfg(target_os = "macos")]
    pub fn service_exists() -> bool {
        plist_path().exists()
    }

    #[cfg(target_os = "macos")]
    pub fn service_running() -> bool {
        let output = Command::new("launchctl")
            .args(["list", "com.zenvora.agent"])
            .output();
        if let Ok(out) = output {
            out.status.success()
        } else {
            false
        }
    }

    #[cfg(target_os = "macos")]
    pub fn service_state() -> String {
        if service_running() {
            "Running".into()
        } else if service_exists() {
            "Installed/Stopped".into()
        } else {
            "NotInstalled".into()
        }
    }

    #[cfg(target_os = "macos")]
    pub fn install_service() -> Result<(), String> {
        let exe = env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy();
        let plist_p = plist_path();
        if let Some(parent) = plist_p.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let plist_content = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zenvora.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
        <string>--run-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/zenvora_agent.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/zenvora_agent.out</string>
</dict>
</plist>"#, exe_str);

        fs::write(&plist_p, plist_content).map_err(|e| e.to_string())?;
        let _ = Command::new("launchctl").args(["unload", plist_p.to_str().unwrap()]).output();
        let out = Command::new("launchctl").args(["load", "-w", plist_p.to_str().unwrap()]).output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).to_string())
        }
    }

    #[cfg(target_os = "macos")]
    pub fn start_service() -> Result<(), String> {
        let plist_p = plist_path();
        if !plist_p.exists() {
            install_service()?;
        }
        let _ = Command::new("launchctl").args(["start", "com.zenvora.agent"]).output();
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn stop_service() {
        let plist_p = plist_path();
        let _ = Command::new("launchctl").args(["stop", "com.zenvora.agent"]).output();
        if plist_p.exists() {
            let _ = Command::new("launchctl").args(["unload", plist_p.to_str().unwrap()]).output();
        }
    }

    #[cfg(target_os = "macos")]
    pub fn uninstall_service() {
        stop_service();
        let plist_p = plist_path();
        let _ = fs::remove_file(plist_p);
    }

    #[cfg(target_os = "linux")]
    fn service_unit_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".config/systemd/user/zenvora.service")
    }

    #[cfg(target_os = "linux")]
    pub fn service_exists() -> bool {
        service_unit_path().exists()
    }

    #[cfg(target_os = "linux")]
    pub fn service_running() -> bool {
        let output = Command::new("systemctl")
            .args(["--user", "is-active", "zenvora"])
            .output();
        if let Ok(out) = output {
            String::from_utf8_lossy(&out.stdout).trim() == "active"
        } else {
            false
        }
    }

    #[cfg(target_os = "linux")]
    pub fn service_state() -> String {
        if service_running() {
            "Running".into()
        } else {
            "Stopped".into()
        }
    }

    #[cfg(target_os = "linux")]
    pub fn install_service() -> Result<(), String> {
        let exe = env::current_exe().map_err(|e| e.to_string())?;
        let p = service_unit_path();
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = format!(r#"[Unit]
Description=Zenvora Agent Service
After=network.target

[Service]
Type=simple
ExecStart={} --run-agent
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
"#, exe.to_string_lossy());
        fs::write(&p, content).map_err(|e| e.to_string())?;
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
        let _ = Command::new("systemctl").args(["--user", "enable", "--now", "zenvora"]).output();
        Ok(())
    }

    #[cfg(target_os = "linux")]
    pub fn start_service() -> Result<(), String> {
        let _ = Command::new("systemctl").args(["--user", "start", "zenvora"]).output();
        Ok(())
    }

    #[cfg(target_os = "linux")]
    pub fn stop_service() {
        let _ = Command::new("systemctl").args(["--user", "stop", "zenvora"]).output();
    }

    #[cfg(target_os = "linux")]
    pub fn uninstall_service() {
        stop_service();
        let _ = Command::new("systemctl").args(["--user", "disable", "zenvora"]).output();
        let _ = fs::remove_file(service_unit_path());
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
        thread::sleep(Duration::from_secs(1));
        start_service()
    }

    pub fn spawn_background_agent(exe: &str) -> Result<(), String> {
        Command::new(exe)
            .arg("--supervise-agent")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
pub use unix::*;
