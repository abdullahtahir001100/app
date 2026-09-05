#[cfg(windows)]
use std::sync::Once;
#[cfg(windows)]
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// Initialize COM once for the process (MTA). Safe to call repeatedly.
pub fn init_process_com() {
    #[cfg(windows)]
    {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                if hr.is_err() {
                    eprintln!("[COM] CoInitializeEx returned {:?}", hr);
                }
            }
        });
    }
}

/// Run work on a short-lived thread with its own COM apartment (avoids MF/audio conflicts).
pub fn run_on_com_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    std::thread::spawn(move || {
        init_process_com();
        work()
    })
    .join()
    .map_err(|_| String::from("COM worker thread failed."))?
}
