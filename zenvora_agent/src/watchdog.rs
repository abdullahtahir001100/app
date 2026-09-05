//! Dual-Process Watchdog & Self-Healing Supervisor
//!
//! Across Windows, macOS, and Linux:
//! 1. When `ZenvoraAgent` starts, it ensures a separate companion process named
//!    `zenvora_supervisor` (or `ZenvoraSupervisor.exe`) is running.
//! 2. The supervisor monitors the Agent PID. If the Agent is killed (via Task Manager,
//!    kill -9, crash, or shutdown), the supervisor immediately relaunches the agent.
//! 3. Symmetrically, the Agent monitors the Supervisor PID. If someone kills the
//!    supervisor, the Agent immediately respawns the supervisor.
//! 4. If neither is running, OS services (Windows SCM / launchd / systemd) restart them.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Returns the path where the companion supervisor binary should live.
pub fn supervisor_exe_path() -> PathBuf {
    let current = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let dir = current.parent().unwrap_or_else(|| Path::new("."));

    #[cfg(windows)]
    return dir.join("ZenvoraSupervisor.exe");

    #[cfg(not(windows))]
    return dir.join("zenvora_supervisor");
}

/// Ensures the companion supervisor binary exists on disk.
/// If not present, creates a copy/hardlink from the current agent binary.
pub fn ensure_supervisor_binary_exists() -> Result<PathBuf, String> {
    let current = env::current_exe().map_err(|e| e.to_string())?;
    let sup_path = supervisor_exe_path();

    if !sup_path.exists() {
        if let Err(e) = fs::copy(&current, &sup_path) {
            eprintln!("[WATCHDOG] Could not copy supervisor binary: {e}");
            return Ok(current); // fallback to self if copy is restricted
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&sup_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&sup_path, perms);
            }
        }
    }

    Ok(sup_path)
}

/// Checks if a given PID is currently active.
pub fn is_pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                if !handle.is_invalid() {
                    let mut exit_code = 0u32;
                    let _ = windows::Win32::System::Threading::GetExitCodeProcess(handle, &mut exit_code);
                    let _ = CloseHandle(handle);
                    return exit_code == 259; // STILL_ACTIVE
                }
            }
        }
        false
    }

    #[cfg(unix)]
    {
        let pid_i = pid as libc::pid_t;
        unsafe { libc::kill(pid_i, 0) == 0 }
    }
}

/// Run as the companion watchdog supervisor.
/// Continuously monitors the target agent PID and restarts it if killed.
pub fn run_supervisor_loop(initial_target_pid: u32, agent_exe: PathBuf) {
    println!("[SUPERVISOR] Watchdog started. Monitoring Agent PID: {initial_target_pid}");
    let mut monitored_pid = initial_target_pid;

    loop {
        thread::sleep(Duration::from_millis(1500));

        if monitored_pid == 0 || !is_pid_alive(monitored_pid) {
            eprintln!("[SUPERVISOR] Agent PID {monitored_pid} died or killed! Self-healing relaunch triggered...");

            let mut cmd = Command::new(&agent_exe);
            cmd.arg("--run-agent");

            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW | 0x00000008); // DETACHED_PROCESS

            match cmd.spawn() {
                Ok(child) => {
                    monitored_pid = child.id();
                    println!("[SUPERVISOR] Agent successfully revived with new PID: {monitored_pid}");
                }
                Err(err) => {
                    eprintln!("[SUPERVISOR] Failed to relaunch agent: {err}. Retrying in 3s...");
                    thread::sleep(Duration::from_secs(3));
                }
            }
        }
    }
}

/// Spawns the companion supervisor from the Agent, and monitors the supervisor.
/// If someone terminates the supervisor, the agent immediately restarts it.
pub fn start_agent_watchdog_thread(stop_flag: Option<Arc<AtomicBool>>) {
    thread::spawn(move || {
        let agent_pid = std::process::id();
        let sup_exe = match ensure_supervisor_binary_exists() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[WATCHDOG] Failed to prepare supervisor: {e}");
                return;
            }
        };

        let agent_exe = env::current_exe().unwrap_or_else(|_| sup_exe.clone());
        let mut sup_pid: Option<u32> = None;

        loop {
            if let Some(flag) = stop_flag.as_ref() {
                if flag.load(Ordering::SeqCst) {
                    break;
                }
            }

            let needs_spawn = match sup_pid {
                None => true,
                Some(pid) => !is_pid_alive(pid),
            };

            if needs_spawn {
                let mut cmd = Command::new(&sup_exe);
                cmd.args([
                    "--watchdog-supervisor",
                    &agent_pid.to_string(),
                    &agent_exe.to_string_lossy(),
                ]);

                #[cfg(windows)]
                cmd.creation_flags(CREATE_NO_WINDOW | 0x00000008); // DETACHED_PROCESS

                match cmd.spawn() {
                    Ok(child) => {
                        let new_pid = child.id();
                        sup_pid = Some(new_pid);
                        println!("[WATCHDOG] Companion supervisor running as PID {new_pid}");
                    }
                    Err(err) => {
                        eprintln!("[WATCHDOG] Could not spawn supervisor ({err}), retry in 5s");
                    }
                }
            }

            thread::sleep(Duration::from_secs(3));
        }
    });
}
