# Zenvora Production Message Codes

Format: **`[ZENVORA-<code>] <text>`**

## Source of truth

| File | Role |
|------|------|
| `shared/zenvora-messages.json` | Canonical catalog (code → text / kind / meaning) |
| `MESSAGES.md` | This human-readable table |
| `lib/messages.ts` | Browser: `alertMsg`, `logMsg`, toast |
| `server/utils/messages.js` | Server: `logMsg`, `jsonMsg` |
| `zenvora_agent/src/messages.rs` | Windows agent (keep codes aligned) |

## Table

| Code | Kind | Message | Meaning |
|------|------|---------|---------|
| 100 | info | Setup started | Headless/GUI provision flow began |
| 101 | success | Agent ready | Local agent process prepared |
| 102 | info | Pairing with cloud | Calling pair API / loading pair token |
| 103 | success | Credentials saved | agent.dat written successfully |
| 104 | info | Installing auto-start service | Creating/updating Windows service |
| 105 | success | Windows service running | ZenvoraAgent service is Running |
| 106 | info | Starting agent worker | Launching interactive --run-agent worker |
| 107 | success | Agent worker started | Worker process spawned |
| 108 | info | Connecting to gateway | Opening /ws/gateway WebSocket |
| 109 | info | Waiting for handshake | Waiting for connected status (up to ~60s) |
| 110 | success | Gateway connected | Handshake completed |
| 111 | warn | Service issue — using backup start | Service install/start failed; fallback path used |
| 112 | warn | Still connecting in background | Handshake window timed out; retries continue |
| 113 | success | Service removed | Uninstall completed |
| 114 | info | Refreshing pairing credentials | Re-pair / gateway refresh from install flags |
| 115 | success | Gateway settings updated | Gateway URL updated in agent.dat |
| 116 | success | Service worker ready | Service path selected as worker host |
| 200 | success | Connected successfully | Final success (device + gateway) |
| 201 | success | Signed in successfully | User login completed |
| 202 | success | Account created | User registration completed |
| 203 | success | Verification successful | OTP verified / credentials unlocked |
| 204 | success | Command copied | Install/short command copied to clipboard |
| 205 | success | Restart command sent | Dashboard sent restart to agent |
| 301 | error | Authentication required | Missing or invalid user session/token |
| 302 | error | Authentication failed | Login rejected (bad password/credentials) |
| 303 | error | Passwords do not match | Register form confirmation mismatch |
| 304 | error | Registration failed | Could not create user account |
| 305 | error | Invalid verification code | OTP incomplete or wrong |
| 306 | error | Verification failed | OTP verify API failed |
| 307 | info | Redirecting to Google sign-in | OAuth redirect started |
| 308 | success | New code sent | OTP resent to email |
| 309 | error | Could not resend code | OTP resend API failed |
| 401 | error | Pairing required — run install from the dashboard | No valid agent credentials |
| 402 | error | Pairing failed | Pair API rejected or network failed |
| 403 | error | Gateway rejected credentials | Auth failure on register / token verify |
| 404 | error | Unauthorized device control | Dashboard user cannot control target device |
| 501 | error | Could not reach gateway | TCP/WS connect failed |
| 502 | warn | Handshake timed out — agent keeps retrying | No connected status within wait window |
| 503 | error | Another agent is already connected for this device | Duplicate device registration |
| 504 | error | Target device offline | Agent not in gateway connection pool |
| 505 | warn | Reconnecting to gateway | Dashboard WS reconnecting |
| 506 | warn | Agent offline — waiting for device | Selected device not online |
| 507 | info | Gateway ready | Dashboard WS open / device online |
| 601 | info | Connecting media socket | Opening /ws/media for stream |
| 602 | error | Media socket not ready | ws-ticket or media upgrade failed |
| 603 | info | Media ready — starting stream | Media WS ready; dispatching START_* |
| 604 | error | Could not start stream | START_STREAM / START_SCREEN_STREAM dispatch failed |
| 605 | info | Waiting for agent stream | Waiting for first binary frames |
| 606 | success | Live stream active | Binary frames arriving |
| 607 | info | Stream stopped | User/agent stopped media stream |
| 608 | warn | Stream interrupted — waiting for frames | Transient STREAM_LOST / gap |
| 609 | error | No live agent found | Device list empty / no online agent |
| 610 | error | Command failed | sys_ack error from agent/control |
| 701 | error | Administrator permission required to install | UAC / ProgramData write needs elevation |
| 702 | error | Install blocked — stop Zenvora service and retry | Access denied while file locked or ACL blocked |
| 703 | error | Could not copy agent to install folder | fs::copy to ProgramData\Zenvora failed |
| 704 | error | Could not start agent from install folder | Spawn of installed exe failed |
| 705 | error | Could not start Windows service | sc start / API start failed |
| 706 | error | Could not start agent worker | Interactive/background worker spawn failed |
| 707 | error | Service operation failed | Generic service install/start/stop/restart error |
| 708 | error | Agent binary not found | ZenvoraAgent.exe missing from public/downloads |
| 709 | error | Short command not ready | Bootstrap ticket / install command missing |
| 710 | error | Could not copy command | Clipboard write failed |
| 801 | error | Could not read saved credentials | agent.dat missing or unreadable |
| 802 | error | Could not save credentials | Failed writing agent.dat |
| 803 | error | Agent configuration is invalid | Corrupt / incomplete config |
| 804 | error | Cloud storage error | Server Mongo/DB persistence failure |
| 805 | warn | Could not write connection status file | connection.status write failed |
| 806 | error | Failed to load data | Generic API fetch failed (admin/list) |
| 807 | error | Failed to update | Generic API update failed |
| 808 | error | Device not found | Requested device missing in DB/registry |
| 809 | error | User not found | Requested user missing in DB |
| 810 | error | File operation failed | File manager / vault API error |
| 901 | error | Camera/screen unavailable in Session 0 — restart while logged in | Agent in Windows Session 0 cannot capture |
| 902 | error | Camera is in use by another app | Camera exclusive lock / busy |
| 903 | error | Could not open camera | Open failed for non-busy reasons (format/driver) |
| 904 | error | Screen capture failed | xcap / display capture returned none |
| 905 | error | Select agent device first | UI action requires a selected online device |
| 906 | error | Enter destination folder path | Vault push needs agent folder path |

## Ranges

| Range | Area |
|-------|------|
| 100–199 | Agent setup / progress |
| 200–299 | Success finals |
| 300–399 | Web auth / OTP |
| 400–499 | Pairing / authorization |
| 500–599 | Gateway connection |
| 600–699 | Media / streams (dashboard) |
| 700–799 | Install / service |
| 800–899 | Storage / API data |
| 900–949 | Hardware / device UI |

## Usage

**Browser**
```ts
import { alertMsg, logMsg, Z } from "@/lib/messages";
alertMsg(Z.SIGNED_IN);
logMsg(Z.STORAGE_ERROR, err.message);
```

**Server**
```js
const { jsonMsg, logMsg, Z } = require('../utils/messages');
return jsonMsg(res, 500, Z.STORAGE_ERROR, err.message);
```

**Agent (Rust)**
```rust
messages::M804_STORAGE_ERROR.display() // => [ZENVORA-804] Cloud storage error
```
