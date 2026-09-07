# Zenvora Enterprise: Complete System Architecture, Network & Data Flow

This document provides the definitive, granular architecture specifications, interactive data flows, and detailed diagrams for the Zenvora ecosystem. It details:
1. **Master All-to-All Component Topology** (Dashboard, Backend, Database, Cloud AI, Agent Nodes, Operating Systems)
2. **Public IP Detection & Dual Routing Matrix** (Direct Local LAN vs Cloud WSS Relay with Auto-Failover)
3. **End-to-End AI Engine & Self-Healing Pipeline** (Centralized Settings, Server AI Ops, On-Device `heal_ai.rs`, `ai_verifier.rs`, and Gemini API)
4. **Binary & JSON Framing Protocol** (Frames 0x01–0x07 with byte-level layouts)
5. **Screen Streaming & AnyDesk-Style Hash Diffing Engine** (ABR & FNV-1a 64-bit frame signatures)
6. **Cross-Platform Command Execution Subsystems** (Windows, macOS, Linux, Android, iOS)
7. **Pairing & Bootstrap Lifecycle** (Visual GUI vs Zero-Touch CLI One-Liner)
8. **Dual-Process Mutual Watchdog & Boot Persistence** (`zenvora_agent` <---> `zenvora_supervisor`)
9. **Multi-OS Subsystem Capabilities Matrix**

> [!IMPORTANT]
> ### 🎨 Live Interactive Visual Diagram Suite Installed
> In markdown text editors, raw Mermaid blocks appear as text/code. We have installed the `mermaid` engine and generated an interactive visual diagram suite:
> - **Open in Browser**: [public/architecture.html](file:///Users/muhammadzubair/Desktop/app/public/architecture.html) (Double-click or run `open public/architecture.html` to view full-color, interactive, zoomable vector diagrams)
> - **In Dashboard**: Visit `/architecture` in the Zenvora Web Cockpit
> - **Export**: Includes one-click **Download SVG** and **Download PNG** buttons for every diagram!

---

## 1. Master All-to-All Component Architecture

The following diagram illustrates every physical and logical entity in the ecosystem, their ports, protocols, data flows, and inter-dependencies.

```mermaid
flowchart TB
    %% ================= CLIENTS & DASHBOARD =================
    subgraph ClientTier ["1. User & Admin Interfaces"]
        AdminWeb["Admin Web Cockpit / Dashboard<br/>(Next.js 14, React 18, Tailwind CSS, Canvas 2D)"]
        MobileAndroid["Android Mobile Client / Agent<br/>(Kotlin, Jetpack Compose, Foreground Service)"]
        MobileIOS["Future iOS Mobile Client / Agent<br/>(Swift, NetworkExtension, ReplayKit)"]
    end

    %% ================= CLOUD BACKEND & ROUTING =================
    subgraph CloudTier ["2. Zenvora Server Infrastructure (Node.js & Express / Port 5000 & 443)"]
        RestRouter["Express REST API Router<br/>(/api/*, /auth, /devices, /settings, /logs)"]
        PublicIpService["Public IP Detection Engine<br/>(/api/network/my-ip - X-Forwarded-For)"]
        WssControlGateway["WSS Control Gateway<br/>(/ws/gateway - JSON Framing & Heartbeats)"]
        WssMediaGateway["WSS High-Speed Media Gateway<br/>(/ws/media - Binary 0x01..0x07 Router)"]
        TicketService["Bootstrap Ticket & Installer Engine<br/>(/r/:code - Dynamic Script Generator)"]
        SSEBus["Live Log Event Bus<br/>(Real-Time Installation Telemetry)"]
        AuthService["JWT & Agent Token Auth Engine<br/>(HTTP-Only Cookie + HMAC Verification)"]
        
        MongoDB[("MongoDB Database<br/>Users, Devices, Logs, Settings, AI Keys")]
        
        RestRouter --- MongoDB
        WssControlGateway --- MongoDB
        RestRouter --> AuthService
        RestRouter --> TicketService
        RestRouter --> PublicIpService
        TicketService --> SSEBus
    end

    %% ================= EXTERNAL AI PLATFORM =================
    subgraph CloudAiTier ["3. Centralized External AI Services"]
        GeminiCloud["Google Gemini 1.5 Pro / Flash API<br/>(https://generativelanguage.googleapis.com)"]
        OpenAiCloud["OpenAI / Custom LLM API<br/>(Optional Centralized Fallback)"]
    end

    %% ================= NETWORK INFRASTRUCTURE =================
    subgraph NetworkTier ["4. Physical & Logical Network Routing"]
        WanGateway["Public Internet WAN Gateway<br/>(ISP Router, NAT, Firewall)"]
        LanSwitch["Local Area Network (LAN)<br/>(Direct Subnet / Wi-Fi Peer-to-Peer)"]
    end

    %% ================= TARGET OPERATING SYSTEMS =================
    subgraph TargetHost ["5. Target Device Nodes (Windows, macOS, Linux)"]
        subgraph BootSupervisor ["Boot Persistence & Watchdog Duo"]
            OSBoot["OS Boot Daemon<br/>(macOS: launchd | Linux: systemd | Win: SCM)"]
            SupervisorProcess["zenvora_supervisor<br/>(Companion Process - PID Watchdog)"]
            MainAgentProcess["ZenvoraAgent Worker<br/>(Main System Agent Binary / .app)"]
            
            OSBoot -->|Autostart on Boot| MainAgentProcess
            MainAgentProcess ---|"Mutual Heartbeat 1.5s"| SupervisorProcess
        end

        subgraph AgentSubsystems ["Agent Internal Architecture"]
            WssClient["WSS Client Thread<br/>(tokio-tungstenite TLS)"]
            LanListener["Local LAN Peer Listener<br/>(Port 5055 - Direct Socket)"]
            Dispatcher["Central Command Router & Frame Dispatcher"]
            
            ScreenEngine["Screen Streaming Engine<br/>(xcap + FNV-1a Hash + MozJPEG)"]
            ShellEngine["Interactive PTY Shell Engine<br/>(zsh / bash / cmd.exe / powershell)"]
            FileEngine["Filesystem & Chunker Engine<br/>(Recursive ZipWriter + 0x06 Chunker)"]
            InputEngine["Input Injection Driver<br/>(CoreGraphics / xdotool / SendInput)"]
            HwEngine["Hardware Controller<br/>(Audio, Brightness, Lock, Battery)"]
            MediaEngine["Media Capture Drivers<br/>(cpal PCM Mic + nokhwa Camera)"]
            
            OnDeviceAI["On-Device AI Verifier<br/>(ai_verifier.rs)"]
            SelfHealer["Autonomous Self-Healer<br/>(heal_ai.rs)"]
        end
    end

    %% Connections
    AdminWeb -->|"1. Query Public IP & Devices"| RestRouter
    AdminWeb ---|"2. WSS Control Channel"| WssControlGateway
    AdminWeb ---|"3. WSS Binary Media Stream"| WssMediaGateway
    AdminWeb -->|"4. Dynamic Installer Request"| TicketService
    SSEBus -->|"5. Real-time Log Stream"| AdminWeb
    
    %% Direct LAN vs WAN
    AdminWeb -.->|"Direct LAN Route"| LanSwitch
    LanSwitch -.->|"Port 5055 Direct Peer"| LanListener
    LanListener --> Dispatcher

    %% Cloud WAN Route
    AdminWeb --> WanGateway
    WanGateway --> RestRouter
    WanGateway --> WssControlGateway
    WanGateway --> WssMediaGateway
    
    %% Agent Cloud Connection
    WssClient ---|"Persistent TLS WebSocket"| WssControlGateway
    WssClient ---|"Media Binary Streams"| WssMediaGateway
    WssClient --> Dispatcher
    
    %% Agent Internal Routing
    Dispatcher --> ScreenEngine
    Dispatcher --> ShellEngine
    Dispatcher --> FileEngine
    Dispatcher --> InputEngine
    Dispatcher --> HwEngine
    Dispatcher --> MediaEngine
    Dispatcher --> OnDeviceAI
    Dispatcher --> SelfHealer

    %% AI Connections
    RestRouter -->|"Query Server-Side AI"| GeminiCloud
    OnDeviceAI -->|"Direct HTTPS Query from Target"| GeminiCloud
    OnDeviceAI -->|"Fallback Query"| OpenAiCloud
    SelfHealer --- OnDeviceAI
    
    %% Mobile Connections
    MobileAndroid ---|"WSS Gateway or Direct"| WssControlGateway
    MobileIOS ---|"WSS Gateway or Direct"| WssControlGateway
```

---

## 2. Public IP, Direct LAN & Cloud Server Communication Flow

A critical feature of Zenvora is **Adaptive Routing**:
- **Direct LAN Mode**: If the Admin Dashboard and the Target Agent share the same Public WAN IP (they are inside the same office, home, or Wi-Fi network), the system offers a direct local socket connection bypassing the cloud relay for <2ms ultra-low latency and zero cloud bandwidth consumption.
- **Cloud Relay Mode**: If the Public WAN IPs differ (they are on different networks across the globe), communication is seamlessly routed through the secure WebSocket Gateway (`/ws/gateway` and `/ws/media`).

### 2.1 Public IP Detection & Topology Decision Flowchart

```mermaid
flowchart TD
    Start["Dashboard Opens / Refreshes Devices View"] --> ClientIP["Browser calls GET /api/network/my-ip"]
    
    subgraph ServerIPDetection ["Server Public IP Resolution (/api/network/my-ip)"]
        ExtractHeader["Extract Client IP from:<br/>1. req.headers['x-forwarded-for']<br/>2. req.headers['cf-connecting-ip']<br/>3. req.socket.remoteAddress"]
        Sanitize["Strip IPv6 Prefix (e.g., '::ffff:198.51.100.45' -> '198.51.100.45')"]
        ExtractHeader --> Sanitize
        Sanitize --> ReturnIP["Return JSON: { ip: clientPublicIp }"]
    end
    
    ClientIP --> ServerIPDetection
    ReturnIP --> StoreClientIP["Browser stores clientPublicIp in State"]
    
    AgentConnect["Target Agent Connects via WSS (/ws/gateway)"] --> AgentIPResolution["Server extracts Agent Public IP from Upgrade Headers"]
    AgentIPResolution --> AgentHeartbeat["Agent reports local LAN IP (e.g. 192.168.1.120) & Port (5055)"]
    AgentHeartbeat --> UpdateDeviceDoc["Update Device Document in MongoDB:<br/>- publicIp: 198.51.100.45<br/>- localIp: 192.168.1.120<br/>- localPort: 5055"]
    
    StoreClientIP --> QueryDevices["Browser queries GET /api/network/devices"]
    UpdateDeviceDoc --> QueryDevices
    QueryDevices --> CompareIPs{"clientPublicIp == device.publicIp?"}

    %% BRANCH A: MATCHING PUBLIC IP
    CompareIPs -- "YES (Same Office / Wi-Fi Subnet)" --> SameNetwork["MATCH DETECTED!<br/>Dashboard & Agent behind same NAT Gateway"]
    SameNetwork --> ShowBanner["Dashboard displays Emerald Banner:<br/>'Direct LAN Eligible - Direct Local Peer'"]
    ShowBanner --> UserChoice{"User selects Route Mode in Dashboard"}
    
    UserChoice -- "Direct Local Route (Active)" --> TestLAN["Browser sends ping to http://device.localIp:5055/ping"]
    TestLAN -- "Ping Succeeds (<5ms)" --> DirectConnected["DIRECT LAN SOCKET ACTIVE<br/>Latency: <2ms | FPS: 60 | Cloud Bandwidth: 0%"]
    TestLAN -- "Ping Fails (Guest Isolation)" --> FallbackRelay["Auto-Fallback to Cloud WSS Relay"]
    
    UserChoice -- "Standard Cloud Mode" --> CloudRelayActive["Route through Cloud WSS Gateway"]

    %% BRANCH B: DIFFERENT PUBLIC IP
    CompareIPs -- "NO (Remote over Internet)" --> DiffNetwork["DIFFERENT PUBLIC IPS DETECTED<br/>Admin: 198.51.100.45 | Agent: 203.0.113.88"]
    DiffNetwork --> ShowRelay["Dashboard displays 'Cloud Relay Route Active'"]
    ShowRelay --> CloudRelayActive
    FallbackRelay --> CloudRelayActive
```

### 2.2 End-to-End Sequence Diagram: Public IP & Dual Routing

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin Browser (Dashboard)
    participant ServerAPI as Next.js / Express Server (/api)
    participant WSSGW as WebSocket Gateway (/ws/gateway)
    participant DB as MongoDB Database
    participant Agent as Target Agent (ZenvoraAgent)
    participant LocalSocket as Local LAN Socket (Port 5055)

    %% Step 1: Client WAN IP Resolution
    Note over Admin, ServerAPI: Phase 1: WAN IP Discovery
    Admin->>ServerAPI: GET /api/network/my-ip
    ServerAPI->>ServerAPI: Parse req.headers['x-forwarded-for']
    ServerAPI-->>Admin: HTTP 200 { ip: "198.51.100.45" }

    %% Step 2: Agent Connection & Registration
    Agent->>WSSGW: WSS Handshake (GET /ws/gateway?token=AGENT_KEY)
    Note over WSSGW: Inspect Upgrade Request Socket:<br/>Remote Public IP = "198.51.100.45"
    Agent->>WSSGW: JSON { action: "DEVICE_REGISTER", localIp: "192.168.1.120", localPort: 5055 }
    WSSGW->>DB: updateOne({ deviceId }, { $set: { publicIp: "198.51.100.45", localIp: "192.168.1.120", localPort: 5055 } })

    %% Step 3: Fetch Devices & Topology Comparison
    Admin->>ServerAPI: GET /api/devices
    DB-->>ServerAPI: Return Devices List JSON (deviceId: MAC-NODE-01, publicIp: 198.51.100.45)
    ServerAPI-->>Admin: Devices Payload JSON

    Note over Admin: Compare: clientPublicIp (198.51.100.45) === device.publicIp (198.51.100.45)<br/>Result: SAME PUBLIC IP -> Direct LAN Eligible!

    %% Scenario A: Direct LAN Mode
    alt Route Selection: Direct LAN Peer-to-Peer Mode
        Admin->>LocalSocket: Direct WebSocket / HTTP Ping (ws://192.168.1.120:5055)
        LocalSocket-->>Admin: Direct Handshake OK (RTT: 0.8 ms)
        Admin->>LocalSocket: Send Command { action: "START_SCREEN_STREAM", fps: 60 }
        LocalSocket-->>Admin: Stream MozJPEG Frame (0x04) directly over Gigabit Ethernet / Wi-Fi 6
        Note over Admin, LocalSocket: Zero load on cloud server, zero latency, maximum fidelity
    else Route Selection: Cloud Relay Mode (or different WAN IPs)
        Admin->>WSSGW: WSS Send { action: "START_SCREEN_STREAM", target: "MAC-NODE-01" }
        WSSGW->>WSSGW: Authorize user & map target session
        WSSGW->>Agent: Relay Frame over persistent WSS tunnel
        Agent-->>WSSGW: Return MozJPEG Binary Frame 0x04
        WSSGW-->>Admin: Relay Binary Frame 0x04 to Cockpit
    end
```

---

## 3. End-to-End AI Engine & Self-Healing Architecture

The Zenvora AI architecture spans three coordinated layers:
1. **Centralized Settings UI**: Single unified configuration screen in Dashboard (`/settings`) for all API keys (Google Gemini, Cloudinary, MongoDB, OpenAI) removing duplicate settings.
2. **Server-Side AI Engine**: AI Ops diagnostic aggregator and conversational assistant.
3. **On-Device Agent AI Engine (`heal_ai.rs` & `ai_verifier.rs`)**: Runs natively inside the Rust binary on Windows, macOS, and Linux. Performs autonomous self-healing, shadow-copy lock bypasses, service watchdog repairs, and direct HTTPS calls to Google Gemini API.

```mermaid
flowchart TB
    %% Central Settings Layer
    subgraph LayerSettings ["1. Centralized Settings Hub in Dashboard"]
        SettingsPage["Settings UI Dashboard<br/>Google Gemini API Key<br/>Model: gemini-1.5-flash or gemini-1.5-pro<br/>Cloudinary, MongoDB and AI Ops Rules"]
        SettingsSave["Save Settings Endpoint<br/>Encrypts with AES-256-GCM and persists to DB"]
        SettingsDb[("MongoDB: SystemSettings Collection")]
        
        SettingsPage --> SettingsSave
        SettingsSave --> SettingsDb
    end

    %% Cloud Server AI Routing
    subgraph LayerServerAI ["2. Cloud AI Ops and Verification"]
        ServerAiController["Server AI Controller<br/>AI Diagnostics and Chatbot Router"]
        AiSyncEngine["Settings Synchronization Worker<br/>Broadcasts SET_AGENT_AI_CONFIG on Agent Pair"]
        
        SettingsDb --> ServerAiController
        SettingsDb --> AiSyncEngine
    end

    %% External Google Gemini Cloud
    subgraph LayerCloudLLM ["3. Google Generative AI Cloud"]
        GeminiEndpoint["Google Gemini 1.5 Cloud API<br/>Cloud Generative Language Endpoint"]
    end

    %% On-Device Agent AI
    subgraph LayerAgentAI ["4. Target Device Native AI Engine"]
        subgraph VerifierSubsystem ["ai_verifier Subsystem"]
            AiConfigCache["In-Memory Agent AI Config Cache<br/>Local Secure Credentials Store"]
            QueryGemini["Agent AI Query Engine<br/>Direct HTTPS POST via reqwest TLS"]
            PayloadVerifier["Payload Integrity Verifier<br/>Validates Device Info and Log Schemas"]
        end

        subgraph HealerSubsystem ["heal_ai Self-Healing Engine"]
            HealDispatcher{"Action Selector"}
            AnalyzeRule["HEAL_ANALYZE<br/>Audit Browser DBs and Notification Queue"]
            FixRule["HEAL_FIX<br/>Clear Locks and Restart Stuck Threads"]
            DeepDiag["HEAL_DEEP_DIAGNOSE<br/>Symptom Analysis and AI Remediation"]
        end

        subgraph TargetOSResources ["Host OS Resources"]
            BrowserLocks["Browser SQLite Databases<br/>Chrome, Edge, Brave, Safari History"]
            ShadowCopy["Shadow Snapshot Engine<br/>Bypasses locked files without killing browser"]
            NotifBuffer["System Notification Ring Buffer"]
            OSServices["OS Service Manager<br/>launchd, systemd, Windows SCM"]
        end
    end

    %% Connections
    AiSyncEngine -->|"SET_AGENT_AI_CONFIG via WSS"| AiConfigCache
    ServerAiController -->|"Server-side Ops Prompts"| GeminiEndpoint
    
    AiConfigCache --> QueryGemini
    QueryGemini -->|"Direct Native Query from Agent"| GeminiEndpoint
    GeminiEndpoint -->|"Return JSON Diagnostic Evaluation"| QueryGemini
    
    HealDispatcher -->|"HEAL_ANALYZE"| AnalyzeRule
    HealDispatcher -->|"HEAL_FIX"| FixRule
    HealDispatcher -->|"HEAL_DEEP_DIAGNOSE"| DeepDiag
    
    AnalyzeRule --> BrowserLocks
    AnalyzeRule --> NotifBuffer
    AnalyzeRule --> OSServices
    
    BrowserLocks -->|"If locked"| ShadowCopy
    FixRule --> OSServices
    
    DeepDiag --> AnalyzeRule
    DeepDiag --> QueryGemini
    QueryGemini -->|"AI Root Cause Analysis"| DeepDiag
    DeepDiag --> FixRule
    DeepDiag -->|"Return HEAL_RESULT JSON"| ServerAiController
    ServerAiController -->|"Render Remediation Report in Cockpit"| SettingsPage
```

### 3.1 Step-by-Step AI Self-Healing Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Cockpit as Admin Dashboard (AI Ops)
    participant Server as Zenvora Cloud Server
    participant Agent as Target Agent (heal_ai.rs)
    participant Gemini as Google Gemini 1.5 API
    participant OS as Host Operating System

    Cockpit->>Server: POST /api/ai/diagnostics/trigger { deviceId: "MAC-NODE-01", action: "HEAL_DEEP_DIAGNOSE" }
    Server->>Agent: WSS Frame { action: "HEAL_DEEP_DIAGNOSE", payload: { scanType: "FULL_SYSTEM" } }

    Note over Agent: Phase 1: Host Inspection (heal_ai.rs)
    Agent->>OS: Audit Browser DBs (~/Library/Application Support/Google/Chrome/Default/History)
    OS-->>Agent: File is LOCKED by Chrome process
    Agent->>OS: Create Shadow In-Memory Snapshot of SQLite file (Lock-Bypass)
    Agent->>OS: Inspect Notification Center Ring Buffer & OS Service Status
    Agent->>Agent: Check memory footprint, CPU spikes & watchdog heartbeat

    Note over Agent: Phase 2: AI Diagnostic Synthesis (ai_verifier.rs)
    Agent->>Agent: Construct diagnostic prompt with system state & error symptoms
    Agent->>Gemini: HTTPS POST https://generativelanguage.googleapis.com/...:generateContent
    Gemini-->>Agent: JSON Response: { rootCause: "Locked DB handle & stale thread", recommendedAction: "SHADOW_REPAIR" }

    Note over Agent: Phase 3: Autonomous Remediation (heal_ai.rs)
    Agent->>OS: Apply shadow copy snapshot mapping
    Agent->>OS: Reinitialize notification listener worker thread
    Agent->>OS: Verify companion watchdog (zenvora_supervisor) is healthy

    Note over Agent: Phase 4: Verification & Telemetry
    Agent->>Server: WSS Return { action: "HEAL_DEEP_DIAGNOSE_RESULT", success: true, aiVerdict: "Repaired", logs: [...] }
    Server-->>Cockpit: SSE Push to Admin Cockpit UI ("AI Self-Healing: System restored to 100% health")
```

---

## 4. WebSocket Framing Protocol: Control vs Binary Media

To ensure optimal performance and zero Base64 conversion overhead, the Zenvora network protocol utilizes two channels:
- **Control Channel (UTF-8 JSON)**: Handshakes, commands, responses, hardware events.
- **Media Channel (Raw Binary ArrayBuffers)**: Live desktop screen, camera feed, audio stream, and chunked file transfer.

### 4.1 Byte-Level Layout of Binary Frames (0x01–0x07)

```
+------------------+-------------------------------------------------------------+
| Byte 0 (Header)  | Bytes 1 .. N (Raw Payload)                                  |
+------------------+-------------------------------------------------------------+
| 0x01             | Camera Video Stream (MozJPEG encoded bytes)                 |
| 0x02             | Camera High-Resolution Snapshot (MozJPEG encoded bytes)     |
| 0x03             | Raw Uncompressed Video Frame (RGB / NV12 bytes)             |
| 0x04             | Live Desktop Screen Stream (MozJPEG encoded bytes)          |
| 0x05             | Full Display Screenshot Capture (MozJPEG / PNG bytes)       |
| 0x06             | Binary File Transfer Chunk (Header: 4B ID + Raw Chunk data) |
| 0x07             | Live Microphone Audio PCM / Opus Stream (Audio buffer)      |
+------------------+-------------------------------------------------------------+
```

### 4.2 Complete Binary Pipeline: Capture to Canvas Render

```mermaid
sequenceDiagram
    autonumber
    participant Screen as Host Display (DXGI / CoreGraphics / XShm)
    participant AgentEncoder as Agent MozJPEG Encoder (Rust)
    participant Gateway as WebSocket Gateway (/ws/media)
    participant WebClient as Browser Canvas Renderer (TypeScript)

    Screen->>AgentEncoder: Grab Physical Frame Buffer (RGBA8888)
    Note over AgentEncoder: 1. Calculate 64-bit FNV-1a Hash<br/>2. If hash matches last frame: SKIP ENCODE<br/>3. If changed: Compress via MozJPEG SIMD (Quality 72-85%)
    AgentEncoder->>AgentEncoder: Prepend Header Byte (0x04)
    AgentEncoder->>Gateway: WebSocket.send(Binary ArrayBuffer with header 0x04)
    
    Note over Gateway: Zero-Copy Relay (Routes buffer directly by target clientId)
    Gateway->>WebClient: WebSocket.onmessage(event.data: ArrayBuffer)
    
    Note over WebClient: Client-Side Demuxing & GPU Blit:
    WebClient->>WebClient: Verify headerByte == 0x04
    WebClient->>WebClient: Create Blob from binary slice (type: image/jpeg)
    WebClient->>WebClient: bitmap = await createImageBitmap(blob)
    WebClient->>WebClient: ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    WebClient->>WebClient: bitmap.close() (Immediate GPU VRAM GC)
```

---

## 5. Desktop Screen Streaming & AnyDesk-Style Hash Diffing

```mermaid
flowchart TD
    CaptureTick["Timer Tick (30-60 FPS)"] --> CaptureFrame["Capture Primary / Selected Monitor<br/>Windows: DXGI Desktop Duplication<br/>macOS: CoreGraphics / ScreenCaptureKit<br/>Linux: X11 XShm / Wayland PipeWire"]
    
    CaptureFrame --> FetchCursor["Query Hardware Mouse Pointer Position (X, Y)<br/>Draw Synthetic Cursor Sprite directly onto Frame Buffer"]
    
    FetchCursor --> ComputeHash["Compute 64-Bit FNV-1a Signature over Frame Buffer Bytes + Mouse (X, Y)"]
    
    ComputeHash --> CompareHash{"Signature == LAST_STREAM_HASH?"}
    
    CompareHash -- "YES (Static Display - Zero Change)" --> DropFrame["SKIP ENCODE & NETWORK DISPATCH<br/>Bandwidth Consumed: 0 KB/s<br/>Agent CPU Usage: ~0%<br/>Network Queues Clear"]
    DropFrame --> SleepTick["Wait for next tick"]
    SleepTick --> CaptureTick
    
    CompareHash -- "NO (Motion, Typing, Cursor Movement)" --> Compress["Adaptive Bitrate (ABR) Engine:<br/>Encode via MozJPEG (72-85% Quality)"]
    Compress --> ConstructPacket["Prepend Header Byte 0x04"]
    ConstructPacket --> WssSend["Dispatch Binary Message over WebSocket"]
    WssSend --> UpdateHash["LAST_STREAM_HASH = Current Signature"]
    UpdateHash --> SleepTick
```

---

## 6. Pairing & Deployment Lifecycle: GUI vs CLI One-Liner

```mermaid
sequenceDiagram
    autonumber
    actor User as Administrator
    participant Dashboard as Dashboard Device Modal
    participant TicketEngine as Ticket Service (/r/:code)
    participant TargetMachine as Target Machine (Win, Mac, Linux)
    participant Agent as Compiled ZenvoraAgent Binary

    alt Option 1: Zero-Interaction CLI Installer (Single Terminal Command)
        User->>Dashboard: Copy One-Liner Command
        Note over Dashboard: macOS: curl -sL https://domain.com/r/CODE?os=mac to bash<br/>Linux: curl -sL https://domain.com/r/CODE?os=linux to bash<br/>Windows: iex irm https://domain.com/r/CODE
        User->>TargetMachine: Paste into Terminal / PowerShell
        TargetMachine->>TicketEngine: GET /r/:code
        TicketEngine-->>TargetMachine: Serve generated shell script with embedded token
        TargetMachine->>TargetMachine: Download native binary from /api/agent/download?format=binary
        TargetMachine->>TargetMachine: Run non-interactive pair: ./ZenvoraAgent --headless --pair-token ...
        TargetMachine->>TargetMachine: Register OS Boot Service (launchd / systemd / SCM)
        TargetMachine->>TargetMachine: Spawn companion watchdog supervisor
        TargetMachine-->>Dashboard: Telemetry pushes "Device Online!"
    else Option 2: Visual Native GUI Application (No Terminal Windows)
        User->>Dashboard: Click "Download Agent"
        Dashboard-->>User: Download ZenvoraAgent-mac.zip or ZenvoraAgent.exe
        User->>TargetMachine: Extract & Double-click ZenvoraAgent.app / ZenvoraAgent.exe
        Note over TargetMachine: macOS: App bundle with AppIcon.icns in Dock<br/>Windows: Windowless PE (no cmd prompt)
        TargetMachine-->>User: Native GUI Dialog (Official Zenvora Logo + "Enter Pair Token")
        User->>TargetMachine: Enter Pair Token & User ID from dashboard
        TargetMachine->>TargetMachine: Validate credentials with Server & Save agent.dat
        TargetMachine->>TargetMachine: Install boot autostart & spawn supervisor
        TargetMachine-->>User: Native Success Dialog ("Connected to Zenvora Enterprise!")
    end
```

---

## 7. Dual-Process Mutual Watchdog & Boot Persistence

To ensure continuous operation and self-recovery from user termination or system crashes, Zenvora employs a **two-process mutual supervisor architecture**:

```mermaid
flowchart TD
    subgraph HostBootTrigger ["Host System Boot & Initialization"]
        PowerOn["System Boot / User Login"]
        LaunchdPlist["macOS: ~/Library/LaunchAgents/com.zenvora.agent.plist<br/>(RunAtLoad=true, KeepAlive=true)"]
        SystemdUnit["Linux: ~/.config/systemd/user/zenvora.service<br/>(Restart=always, WantedBy=default.target)"]
        WindowsService["Windows: SCM Service 'ZenvoraAgent'<br/>(start= auto, failure= restart)"]
        
        PowerOn --> LaunchdPlist
        PowerOn --> SystemdUnit
        PowerOn --> WindowsService
    end

    subgraph Process1 ["Process 1: Main Agent (ZenvoraAgent)"]
        MainWorker["ZenvoraAgent Main Worker (PID: A)<br/>Runs WSS Client, Screen, Shell, Audio, AI"]
        AgentWatchLoop["Agent Watchdog Thread<br/>Checks Supervisor PID every 3.0s"]
    end

    subgraph Process2 ["Process 2: Supervisor Watchdog (zenvora_supervisor)"]
        SupProcess["zenvora_supervisor (PID: S)<br/>Lightweight Process Monitor"]
        SupWatchLoop["Supervisor Watch Loop<br/>Checks Agent PID every 1.5s"]
    end

    LaunchdPlist -->|"Spawn on Boot"| MainWorker
    SystemdUnit -->|"Spawn on Boot"| MainWorker
    WindowsService -->|"Spawn on Boot"| MainWorker

    MainWorker -->|"Ensure supervisor spawned"| SupProcess

    AgentWatchLoop -.->|"Check Supervisor Active"| SupProcess
    SupWatchLoop -.->|"Check Agent Active"| MainWorker

    SupProcess -->|"Instant Respawn on Terminate"| RelaunchAgent["Supervisor instantly respawns ZenvoraAgent"]
    RelaunchAgent --> MainWorker

    MainWorker -->|"Instant Respawn on Terminate"| RelaunchSupervisor["Agent instantly respawns zenvora_supervisor"]
    RelaunchSupervisor --> SupProcess
```

---

## 8. Multi-OS Subsystem Support & Compatibility Matrix

| Feature / Subsystem | Windows Engine | macOS Engine | Linux Engine | Android Agent | Future iOS Agent |
|---|---|---|---|---|---|
| **Binary Artifact** | `ZenvoraAgent.exe` (PE) | `ZenvoraAgent.app` (.app bundle) | `ZenvoraAgent` (ELF) | `Zenvora.apk` (Kotlin APK) | Native iOS App (Swift) |
| **Boot Autostart** | Windows SCM (`sc.exe create`) | `launchd` plist (`RunAtLoad=true`) | `systemd` user service unit | Android `BootReceiver` | iOS BackgroundTasks |
| **Watchdog Revival** | `zenvora_supervisor` (1.5s) | `zenvora_supervisor` (1.5s) | `zenvora_supervisor` (1.5s) | Foreground Service auto-restart | Push Notification wake-up |
| **GUI Pairing Dialog** | Native Dialog (Windowless PE) | AppleScript Dialog with **Zenvora Logo** | GTK `zenity` / Qt `kdialog` | Native Jetpack Compose | Native SwiftUI Modal |
| **CLI One-Liner** | `iex(irm '.../r/CODE')` | `curl -sL '.../r/CODE?os=mac' \| bash` | `curl -sL '.../r/CODE?os=linux' \| bash` | ADB shell script | MDM mobileconfig |
| **Direct LAN Route** | Port 5055 Peer Socket | Port 5055 Peer Socket | Port 5055 Peer Socket | Local HTTP server | Local Network socket |
| **Screen Streaming** | `xcap` DXGI + MozJPEG | `xcap` CoreGraphics + MozJPEG | `xcap` XShm/Wayland + MozJPEG | MediaProjection API | ReplayKit broadcast |
| **Hash Diffing** | FNV-1a 64-bit diffing | FNV-1a 64-bit diffing | FNV-1a 64-bit diffing | Frame hash comparison | Frame hash comparison |
| **Mouse Injection** | Win32 `SendInput` | CoreGraphics `CGEvent` HID tap | `xdotool mousemove / click` | AccessibilityService tap | Native touch injection |
| **Keyboard Injection** | Win32 `SendInput` | `CGEvent` & AppleScript keystroke | `xdotool key / type` | InputMethodService | Native key injection |
| **Interactive Shell** | `cmd.exe` / `powershell.exe` | `/bin/zsh -c` / `/bin/bash -c` | `/bin/bash -c` / `/bin/sh -c` | Sandboxed sh / su shell | Sandboxed local command |
| **Filesystem Roots** | Drive letters (`C:\`, `D:\`) | `Macintosh HD (/ )`, `/Volumes/*` | `Root (/ )`, Home, Desktop | Internal & SD storage | App sandbox container |
| **Volume & Brightness** | CoreAudio COM & DDC/CI | AppleScript System Events | PulseAudio `pactl` & xrandr | `AudioManager` | `AVAudioSession` |
| **Screen Lock** | Win32 `LockWorkStation()` | `pmset displaysleepnow` | `loginctl lock-session` | DevicePolicyManager | System screen lock |
| **Battery Level** | Win32 `GetSystemPowerStatus` | `pmset -g batt` parsing | `/sys/class/power_supply/BAT*` | Android `BatteryManager` | `UIDevice.batteryLevel` |
| **AI Self-Healing** | `heal_ai.rs` + Gemini API | `heal_ai.rs` + Gemini API | `heal_ai.rs` + Gemini API | Cloud-assisted diagnostics | Cloud-assisted diagnostics |
| **Server Changes Needed** | **None** | **None** | **None** | **None (100% Compatible)** | **Zero Modifications** |

---

## 9. Verification & Summary

- **Public IP & Direct LAN**: Documented with exact decision logic, `/api/network/my-ip` header parsing, MongoDB device schema update, and client-side fallback.
- **AI Architecture**: Fully details the tripartite pipeline (Settings `/settings` -> Server AI Ops -> On-Device `heal_ai.rs` & `ai_verifier.rs` querying Google Gemini API).
- **All-to-All Coverage**: All components, connections, binary frames (0x01–0x07), and operating systems are explicitly diagrammed with complete end-to-end interactions.
