//! Launch the agent into the active interactive Windows session.
//! LocalSystem Session 0 cannot capture screen/browser of a logged-in user.

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::ptr;
#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(windows)]
use windows::core::{PCWSTR, PWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::{
    CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
#[cfg(windows)]
use windows::Win32::Security::{
    DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS,
};
#[cfg(windows)]
use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
#[cfg(windows)]
use windows::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSEnumerateSessionsW, WTSFreeMemory, WTSGetActiveConsoleSessionId,
    WTSQueryUserToken, WTS_CURRENT_SERVER_HANDLE, WTSActive, WTS_SESSION_INFOW,
};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcessId, WaitForSingleObject, CREATE_NO_WINDOW,
    CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
};

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
pub fn is_session_zero() -> bool {
    unsafe {
        let mut session_id = 0u32;
        if ProcessIdToSessionId(GetCurrentProcessId(), &mut session_id).is_ok() {
            return session_id == 0;
        }
    }
    false
}

#[cfg(windows)]
fn find_interactive_session_id() -> Option<u32> {
    unsafe {
        let console = WTSGetActiveConsoleSessionId();
        if console != 0 && console != 0xFFFFFFFF {
            return Some(console);
        }

        let mut info_ptr: *mut WTS_SESSION_INFOW = ptr::null_mut();
        let mut count: u32 = 0;
        if WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut info_ptr, &mut count).is_err()
            || info_ptr.is_null()
            || count == 0
        {
            return None;
        }

        let mut chosen: Option<u32> = None;
        let slice = std::slice::from_raw_parts(info_ptr, count as usize);
        for sess in slice {
            if sess.State == WTSActive && sess.SessionId != 0 {
                chosen = Some(sess.SessionId);
                break;
            }
        }
        WTSFreeMemory(info_ptr as *mut _);
        chosen
    }
}

/// Spawn `exe --run-agent` in the interactive user session and wait until it exits
/// (or until `stop` is set).
#[cfg(windows)]
pub fn spawn_agent_in_active_user_session(
    exe: &Path,
    stop: &AtomicBool,
) -> Result<(), String> {
    unsafe {
        let session_id = find_interactive_session_id()
            .ok_or_else(|| "No interactive user session is logged on.".to_string())?;

        let mut user_token = HANDLE::default();
        WTSQueryUserToken(session_id, &mut user_token)
            .map_err(|e| format!("WTSQueryUserToken failed: {}", e))?;

        let mut primary_token = HANDLE::default();
        let dup = DuplicateTokenEx(
            user_token,
            TOKEN_ALL_ACCESS,
            None,
            SecurityImpersonation,
            TokenPrimary,
            &mut primary_token,
        );
        let _ = CloseHandle(user_token);
        dup.map_err(|e| format!("DuplicateTokenEx failed: {}", e))?;

        let mut env = ptr::null_mut();
        let _ = CreateEnvironmentBlock(&mut env, primary_token, false);

        let mut exe_wide = to_wide(&exe.to_string_lossy());
        let mut cmd_wide = to_wide(&format!("\"{}\" --run-agent", exe.display()));
        let mut desktop = to_wide("winsta0\\default");

        let mut startup = STARTUPINFOW::default();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup.lpDesktop = PWSTR(desktop.as_mut_ptr());

        let mut process_info = PROCESS_INFORMATION::default();

        let created = CreateProcessAsUserW(
            primary_token,
            PCWSTR(exe_wide.as_mut_ptr()),
            PWSTR(cmd_wide.as_mut_ptr()),
            None,
            None,
            false,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            if env.is_null() {
                None
            } else {
                Some(env)
            },
            None,
            &startup,
            &mut process_info,
        );

        if !env.is_null() {
            let _ = DestroyEnvironmentBlock(env);
        }
        let _ = CloseHandle(primary_token);

        created.map_err(|e| format!("CreateProcessAsUser failed: {}", e))?;

        if process_info.hThread != INVALID_HANDLE_VALUE {
            let _ = CloseHandle(process_info.hThread);
        }

        while !stop.load(Ordering::SeqCst) {
            let wait = WaitForSingleObject(process_info.hProcess, 1000);
            if wait == WAIT_OBJECT_0 {
                break;
            }
            if wait != WAIT_TIMEOUT {
                break;
            }
        }

        if process_info.hProcess != INVALID_HANDLE_VALUE {
            let _ = CloseHandle(process_info.hProcess);
        }

        Ok(())
    }
}

#[cfg(not(windows))]
pub fn is_session_zero() -> bool {
    false
}

#[cfg(not(windows))]
pub fn spawn_agent_in_active_user_session(
    _exe: &std::path::Path,
    _stop: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    Err("Interactive session launch is Windows-only.".into())
}
