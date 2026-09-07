#[cfg(not(windows))]
pub use crate::platform::{
    read_display_brightness, read_system_volume, send_text_to_active_window,
    set_display_brightness, set_system_volume,
};

#[cfg(windows)]
mod win {
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, SetVCPFeature, PHYSICAL_MONITOR,
    },
    Win32::Foundation::{BOOL, LPARAM, RECT, TRUE},
    Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, EnumDisplayDevicesW, EnumDisplayMonitors, GetDC, ReleaseDC,
        DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE, HDC, HMONITOR,
    },
    Win32::Media::Audio::Endpoints::IAudioEndpointVolume,
    Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator},
    Win32::System::Com::{CoCreateInstance, CLSCTX_ALL},
    Win32::UI::ColorSystem::SetDeviceGammaRamp,
};

/// VCP code for monitor brightness over DDC/CI.
const VCP_BRIGHTNESS: u8 = 0x10;

static LAST_GAMMA_BRIGHTNESS: AtomicU32 = AtomicU32::new(100);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[repr(C)]
struct GammaRamp {
    red: [u16; 256],
    green: [u16; 256],
    blue: [u16; 256],
}

fn run_powershell(script: &str) -> Result<String, String> {
    let output = Command::new("powershell")
    
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .output()
        .map_err(|err| format!("PowerShell launch failed: {}", err))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            stdout
        } else {
            stderr
        })
    }
}

fn build_gamma_ramp(factor: f32) -> GammaRamp {
    let mut ramp = GammaRamp {
        red: [0; 256],
        green: [0; 256],
        blue: [0; 256],
    };

    for i in 0..256 {
        let v = ((i as f32 / 255.0) * factor * 65535.0).round() as u16;
        ramp.red[i] = v;
        ramp.green[i] = v;
        ramp.blue[i] = v;
    }

    ramp
}

#[cfg(windows)]
struct DdcBrightnessCtx {
    level: u32,
    applied: bool,
}

#[cfg(windows)]
unsafe extern "system" fn apply_ddc_to_monitor(
    hmonitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut DdcBrightnessCtx);
    let mut count = 0u32;

    if GetNumberOfPhysicalMonitorsFromHMONITOR(hmonitor, &mut count).is_err() || count == 0 {
        return TRUE;
    }

    let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
    if GetPhysicalMonitorsFromHMONITOR(hmonitor, &mut monitors).is_err() {
        return TRUE;
    }

    let scaled_100 = ctx.level;
    let scaled_255 = ((ctx.level * 255) / 100).max(1);

    for monitor in &monitors {
        if SetVCPFeature(monitor.hPhysicalMonitor, VCP_BRIGHTNESS, scaled_100) != 0 {
            ctx.applied = true;
        } else if SetVCPFeature(monitor.hPhysicalMonitor, VCP_BRIGHTNESS, scaled_255) != 0 {
            ctx.applied = true;
        }
    }

    let _ = DestroyPhysicalMonitors(&monitors);
    TRUE
}

#[cfg(windows)]
fn set_brightness_ddc(level: u32) -> Result<(), String> {
    let mut ctx = DdcBrightnessCtx {
        level: level.min(100),
        applied: false,
    };

    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(apply_ddc_to_monitor),
            LPARAM(&mut ctx as *mut DdcBrightnessCtx as isize),
        );
    }

    if ctx.applied {
        Ok(())
    } else {
        Err("DDC/CI brightness not supported by connected monitor(s).".into())
    }
}

#[cfg(not(windows))]
fn set_brightness_ddc(_level: u32) -> Result<(), String> {
    Err("DDC/CI brightness is only supported on Windows.".into())
}

#[cfg(windows)]
fn apply_gamma_to_hdc(hdc: HDC, ramp: &GammaRamp) -> bool {
    if hdc.is_invalid() {
        return false;
    }
    unsafe {
        SetDeviceGammaRamp(hdc, (ramp as *const GammaRamp).cast()).as_bool()
    }
}

#[cfg(windows)]
fn set_brightness_gamma_all(level: u32) -> Result<(), String> {
    let level = level.min(100);
    let factor = (level as f32 / 100.0).clamp(0.05, 1.0);
    let ramp = build_gamma_ramp(factor);
    let mut applied = false;

    unsafe {
        let primary = GetDC(None);
        if apply_gamma_to_hdc(primary, &ramp) {
            applied = true;
        }
        if !primary.is_invalid() {
            let _ = ReleaseDC(None, primary);
        }

        let mut index = 0u32;
        loop {
            let mut device = DISPLAY_DEVICEW::default();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

            if !EnumDisplayDevicesW(None, index, &mut device, Default::default()).as_bool() {
                break;
            }

            if device.StateFlags & DISPLAY_DEVICE_ACTIVE != 0 {
                let hdc = CreateDCW(None, PCWSTR(device.DeviceName.as_ptr()), None, None);
                if apply_gamma_to_hdc(hdc, &ramp) {
                    applied = true;
                }
                if !hdc.is_invalid() {
                    let _ = DeleteDC(hdc);
                }
            }

            index += 1;
        }
    }

    if applied {
        LAST_GAMMA_BRIGHTNESS.store(level, Ordering::Relaxed);
        Ok(())
    } else {
        Err("Gamma brightness could not be applied to any display.".into())
    }
}

#[cfg(not(windows))]
fn set_brightness_gamma_all(_level: u32) -> Result<(), String> {
    Err("Gamma brightness is only supported on Windows.".into())
}

fn set_brightness_wmi(level: u32) -> Result<(), String> {
    let level = level.min(100);
    let script = format!(
        r#"
$level = {level}
$methods = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop)
if ($methods.Count -lt 1) {{ throw "No WMI brightness interface found" }}
foreach ($m in $methods) {{ $null = $m.WmiSetBrightness(1, $level) }}
Write-Output "OK"
"#
    );
    run_powershell(&script).map(|_| ())
}

pub fn set_display_brightness(level: u32) -> Result<(), String> {
    let level = level.min(100);
    let mut errors = Vec::new();
    let mut applied = false;

    // Gamma first — immediate visible feedback on desktop monitors.
    match set_brightness_gamma_all(level) {
        Ok(()) => {
            println!("[BRIGHTNESS] Applied via gamma ramp at {}%", level);
            applied = true;
        }
        Err(err) => errors.push(err),
    }

    match set_brightness_ddc(level) {
        Ok(()) => {
            println!("[BRIGHTNESS] Applied via DDC/CI at {}%", level);
            applied = true;
        }
        Err(err) => errors.push(err),
    }

    match set_brightness_wmi(level) {
        Ok(()) => {
            println!("[BRIGHTNESS] Applied via WMI at {}%", level);
            applied = true;
        }
        Err(err) => errors.push(err),
    }

    if applied {
        Ok(())
    } else {
        Err(errors.join(" | "))
    }
}

pub fn read_display_brightness() -> Option<u32> {
    let script = r#"
try {
  $level = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop |
    Select-Object -ExpandProperty CurrentBrightness -First 1)
  if ($null -ne $level) { [int]$level }
} catch { }
"#;
    run_powershell(script)
        .ok()
        .and_then(|raw| raw.lines().last()?.trim().parse::<u32>().ok())
        .map(|v| v.min(100))
        .or_else(|| Some(LAST_GAMMA_BRIGHTNESS.load(Ordering::Relaxed)))
}

#[cfg(windows)]
pub fn set_system_volume(level: u32) -> Result<(), String> {
    crate::com_runtime::run_on_com_thread(move || set_system_volume_inner(level))
}

#[cfg(windows)]
fn set_system_volume_inner(level: u32) -> Result<(), String> {
    let scalar = (level.min(100) as f32 / 100.0).clamp(0.0, 1.0);

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Audio enumerator failed: {}", e))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Default audio endpoint failed: {}", e))?;
        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Audio endpoint activate failed: {}", e))?;
        volume
            .SetMasterVolumeLevelScalar(scalar, std::ptr::null())
            .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {}", e))?;
    }

    Ok(())
}

#[cfg(windows)]
pub fn read_system_volume() -> Option<u32> {
    crate::com_runtime::run_on_com_thread(read_system_volume_inner).ok()
}

#[cfg(windows)]
fn read_system_volume_inner() -> Result<u32, String> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Audio enumerator failed: {}", e))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Default audio endpoint failed: {}", e))?;
        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Audio endpoint activate failed: {}", e))?;
        let scalar = volume
            .GetMasterVolumeLevelScalar()
            .map_err(|e| format!("GetMasterVolumeLevelScalar failed: {}", e))?;
        Ok((scalar * 100.0).round().min(100.0) as u32)
    }
}

pub fn send_text_to_active_window(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("No text provided.".into());
    }

    let escaped = escape_sendkeys(text);
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.SendKeys]::SendWait('{}')",
        escaped.replace('\'', "''")
    );

    run_powershell(&script).map(|_| ())
}

fn escape_sendkeys(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for ch in text.chars() {
        match ch {
            '+' | '^' | '%' | '~' | '(' | ')' | '{' | '}' | '[' | ']' => {
                out.push('{');
                out.push(ch);
                out.push('}');
            }
            '\n' => out.push_str("{ENTER}"),
            '\t' => out.push_str("{TAB}"),
            _ => out.push(ch),
        }
    }
    out
}
}

#[cfg(windows)]
pub use win::*;
