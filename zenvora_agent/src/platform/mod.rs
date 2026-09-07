//! Platform abstraction layer for macOS, Linux, and Windows.

pub mod macos;
pub mod linux;
pub mod windows;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(windows)]
pub use windows::*;
