# Zenvora Agent — Windows support notes

## Supported versions
- Target: **Windows 7 SP1 through Windows 11** (x64).
- Prefer Win7-safe Win32 APIs (`GetDiskFreeSpaceExW`, basic file attributes, `cmd.exe`).
- Avoid Win10+-only APIs in new agent code paths (e.g. toast APIs that require Win8+ should degrade gracefully).

## Transport (WS-first)
- Control: `wss://…/ws/control` (ZV binary framing).
- Media: `wss://…/ws/media` (screen/camera).
- Commands: `wss://…/ws/gateway`.
- Raw TCP `:9443` is **off by default**. Set `ENABLE_CONTROL_TCP=1` only if needed.

## Slow networks
- Heartbeat: 25s ping / 75s timeout on dashboard, agent gateway, and control/media channels.
- Reconnect backoff: 1s → 2s → 5s → 10s → 20s → 30s.
- Screen ABR (`screen_abr.rs`) lowers width/quality/fps when acks report high buffer/RTT.
- Server drops media frames when `bufferedAmount > 1MB` instead of blocking heartbeats.

## Build
```bash
cd zenvora_agent
cargo build --release
```

If the Rust toolchain or a crate requires a newer Windows SDK than Win7 supports, document the minimum OS in release notes and keep runtime feature detection for optional APIs.
