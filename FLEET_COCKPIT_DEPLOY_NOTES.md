# Fleet Grid + Device Cockpit — Deploy Notes

_Last updated: 2026-08-26_

## TL;DR

You now have two new full-page views:

- **`/fleet`** — the Fleet Grid: every device's live screen as a tile on one pannable / zoomable canvas, built to scale to ~1000 devices. Click any tile to open that device's cockpit.
- **`/cockpit?device=<id>`** — the Device Cockpit: one full-page workspace with draggable, resizable panels for that device's **live screen + remote control, live camera, mic, app usage, history, secure shell, and the AI assistant.**

**The single most important thing:** the *blur* and *slowness* fixes are mostly in the **Rust agent**. The web app is ready and already asks for sharp, high-FPS frames — but the agent has to actually *produce* them. **You must rebuild and redeploy the Windows `.exe`** to get the AnyDesk-like result. Everything web-side works the moment you deploy the Next app; see section 2 for what stays capped until the agent is rebuilt.

---

## 1. Works immediately (web only — just deploy the Next app)

No agent rebuild needed for any of this. Deploy the Next app (your custom `node server.js`) and it's live.

### New files

- `app/fleet/page.tsx` — Fleet Grid page
- `app/cockpit/page.tsx` — Device Cockpit orchestrator
- `components/cockpit/floating-panel.tsx` — dependency-free draggable/resizable panel shell
- `components/cockpit/screen-panel.tsx` — live screen + mouse/keyboard control
- `components/cockpit/camera-panel.tsx` — live camera (JPEG + raw-RGB decode, flip)
- `components/cockpit/mic-panel.tsx` — live mic playback + VU meter
- `components/cockpit/shell-panel.tsx` — CMD / PowerShell terminal
- `components/cockpit/usage-panel.tsx` — app-usage bars
- `components/cockpit/history-panel.tsx` — activity / browser / apps / calls / SMS / contacts

### Modified files

- `components/app-sidebar.tsx` — added a **Fleet Grid** link (visible to anyone who can see Screen Monitor).
- `hooks/use-screen-remote.ts` — one-line Blob typing fix (see section 5).
- `components/shell/agent-chat-message.tsx` — corrected a broken type import (see section 5).

### How the scale target is met (Fleet Grid)

The grid can hold thousands of tiles because it does two things:

1. **Virtualized DOM** — only tiles inside the current viewport are actually rendered; the rest are pure math (position + size), so 1000 devices don't mean 1000 live DOM nodes.
2. **Bounded live streaming** — at most **36 screens stream at once** (`MAX_LIVE_STREAMS`), and only the ones nearest the center of your viewport. As you pan, streams start/stop automatically so bandwidth stays flat no matter how big the fleet is. Thumbnails use a small, slow preset (`saver`, 6 fps, 480px wide) so each one is cheap; the full-quality stream is reserved for the cockpit.

Pan by dragging the background, zoom with the scroll wheel, and click any screen to open its cockpit.

### How the Cockpit is wired

Each panel reuses the same gateway plumbing your existing pages use, so there's no new backend:

- **Screen** auto-starts on open and reads frames off the shared dashboard gateway socket (the same socket that already receives every owned device's frames). It deliberately does **not** open a second dedicated media socket, so opening the cockpit does **not** double your screen bandwidth. Mouse move/down/up, wheel, and keyboard are forwarded as `REMOTE_*` actions exactly like the standalone Screen page.
- **Mic** listens on that same gateway socket, because agent audio is only relayed to owner dashboard sockets — not to the per-device media channel.
- **Camera** uses the dedicated media socket (with a gateway fallback), matching the existing Camera page.
- **Usage / History** call your existing `/api/logs/*` endpoints (served by `server.js`) and also accept live deltas pushed from the agent.
- **AI** is the existing self-contained `AgentChatPanel`.

Panels are independently draggable and resizable, can be minimized/closed and reopened from the launcher chips in the header, and "Reset layout" restores the default arrangement. There's also a device switcher in the header so you can hop between devices without going back to the grid.

### Verification done

A scoped TypeScript check (`tsc --noEmit`) over both new pages **plus their entire import graph** — every cockpit panel, the sidebar, the gateway/media/frame libs, the screen-remote hook, and the AI chat components — passes with **zero errors**. (A full-project `tsc` is too slow for the sandbox's command limit, so the check was scoped to the reachable graph of the changed code, which is what matters here.)

---

## 2. Requires an agent rebuild (Windows `.exe`) — you must build & push

This is where the actual "sharp + fast like AnyDesk" comes from. These changes are in the Rust agent, which only builds on your Windows machine — this environment can edit the source but cannot compile or ship the `.exe`.

**Agent source already changed for sharpness/speed:**

- `zenvora_agent/src/screen.rs` — higher-quality downscale (Triangle/bilinear resample) so scaled frames are crisp instead of blocky, plus a light post-scale sharpen.
- `zenvora_agent/src/screen_commands.rs` — richer quality presets and honoring of `max_width` / `target_fps` coming from the web (`SET_SCREEN_QUALITY`, the `quality` + `target_fps` on `START_SCREEN_STREAM`).

**What to do:**

1. On your Windows box, rebuild the agent: `cargo build --release` in `zenvora_agent/`.
2. Distribute the new `.exe` to your devices (your normal update path / `agent_update`).
3. After devices pick it up, the cockpit's **Sharp / Ultra** quality options and higher FPS will actually take effect.

**Until you rebuild:** old agents ignore `max_width`/`target_fps` and fall back to the `saver` preset. The web UI won't error — it just won't look sharp or run at high FPS. New/updated agents unlock the full quality range. In short: **the web is ready; the picture quality is gated on the agent rebuild.**

---

## 3. Deferred optimization — keyframe + identical-frame suppression

This is the one meaningful agent-side improvement **not yet implemented**. It's the biggest remaining bandwidth/latency win and is what lets a large fleet stay smooth. It belongs in `zenvora_agent/src/network.rs`, in `schedule_screen_capture` (currently it captures + encodes + sends on every tick with no dedup).

**Goal:** stop sending frames that didn't change, and recover cleanly when a viewer joins mid-stream.

**Design:**

1. **Identical-frame suppression.** After capturing a frame, compute a fast hash of the raw pixels (e.g. `xxhash`/`seahash` over the buffer, or a cheap sampled hash of every Nth row for speed). Keep the previous frame's hash per display. If the new hash equals the last one, **skip encoding and sending** — a static desktop then costs almost nothing.
2. **Keyframe cadence.** Force-send a frame at least every N ticks (e.g. every 1–2 seconds) even when the hash is unchanged, so a viewer who just subscribed, or one that dropped a packet, always gets a fresh full frame quickly. Track "ticks since last sent" and override suppression when it exceeds the cadence.
3. **Send-on-subscribe.** When a new viewer subscribes to a display that's mid-stream, immediately mark the next tick as a forced keyframe for that display so they don't stare at a blank panel until the next natural change.
4. **(Optional, larger) Tile delta encoding.** Split the frame into a grid of tiles, hash each tile, and only re-encode/send tiles that changed, with a periodic full keyframe. This is the classic AnyDesk-style approach and gives the largest savings on typing/scrolling, but it's a bigger change — do steps 1–3 first; they're ~90% of the benefit for far less code.

**Why it's worth it:** most remote sessions are mostly-static screens. Suppression turns "encode+send 20 fps forever" into "send only on change + a heartbeat keyframe," which cuts CPU on the agent and bandwidth on the wire dramatically — directly attacking the "slow" complaint at the source, and letting the 36-stream Fleet Grid cap go further.

---

## 4. How to run / verify locally

1. Start the app: `npm run dev` (this runs `node server.js`, the custom Express + WebSocket gateway).
2. Log in, open the sidebar → **Fleet Grid**. You should see a tile per device; online ones near the viewport begin streaming thumbnails.
3. Click a tile → the **Cockpit** opens for that device. The screen panel auto-starts. Try dragging panel title bars, resizing from the bottom-right corner, minimizing/closing, and "Reset layout."
4. To sanity-check types the same way I did, from the repo root run a scoped check (full-project `tsc` is fine too if you're not time-limited):
   ```
   npx tsc --noEmit
   ```

---

## 5. Pre-existing issues fixed along the way

While type-checking the new code's dependency graph, three real (previously silent) TypeScript errors surfaced. Your dev runtime uses SWC via the custom server, which strips types without checking — so these never blocked you, but they were genuine:

- **`components/shell/agent-chat-message.tsx`** imported `AgentMessage` from `./agent-chat-panel`, which never exported it. The type actually lives in `hooks/use-agent-chat.ts`. Fixed the import to point there (type-only import, zero runtime change).
- **`hooks/use-screen-remote.ts`** and **`app/fleet/page.tsx`** built a `Blob` from a `Uint8Array` subarray view, which the current TypeScript lib rejects (`ArrayBufferLike` vs `ArrayBuffer`). Fixed by using a fresh `.slice()` copy — the same pattern the camera panel already uses.

None of these change runtime behavior; they just make the code type-clean.
