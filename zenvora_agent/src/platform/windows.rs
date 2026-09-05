//! Windows platform implementation stubs and re-exports.

#[cfg(windows)]
pub use crate::windows_controls::*;

#[cfg(not(windows))]
pub fn read_system_volume() -> Option<u32> { None }
#[cfg(not(windows))]
pub fn set_system_volume(_level: u32) -> Result<(), String> { Ok(()) }
#[cfg(not(windows))]
pub fn read_display_brightness() -> Option<u32> { None }
#[cfg(not(windows))]
pub fn set_display_brightness(_level: u32) -> Result<(), String> { Ok(()) }
#[cfg(not(windows))]
pub fn send_text_to_active_window(_text: &str) -> Result<(), String> { Ok(()) }
