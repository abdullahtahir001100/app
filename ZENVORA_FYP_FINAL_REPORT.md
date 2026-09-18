# Final Year Project (FYP) Report & Specification Document
# Project Name: ZENVORA (Unified Endpoint Management & Remote Intelligence Platform)

---

## 1. Project Title & Overview
* **Project Title:** ZENVORA: Unified Remote Administration, Employee Telemetry, and Endpoint Intelligence Platform
* **Domain:** Remote Monitoring and Management (RMM), Cybersecurity, Distributed Systems & AI Diagnostics
* **Target Audience:** IT Managers/Enterprises, Parents & Home Users, Junior IT Administrators & Students

### Executive Summary
**ZENVORA** is an all-in-one next-generation Remote Endpoint Control and Monitoring System designed to bridge the critical gap between traditional remote desktop tools, complex enterprise RMM suites, and privacy-invasive commercial monitoring software. 

Traditional tools either force a choice between passive screen-sharing (e.g., AnyDesk, TeamViewer) or overly complex command-line administration tools. Furthermore, commercial parental tracking apps compromise user privacy by storing sensitive telemetry on third-party cloud servers. ZENVORA unifies **low-latency real-time remote desktop control**, **stealth/background system management (shell, services, process manager)**, **workplace employee productivity tracking**, and **edge-assisted AI telemetry** into a unified, privacy-centric, and user-friendly web cockpit.

---

## 2. Motives & Core Objectives (Why ZENVORA was Built)

### A. Corporate & Office Employee Tracking (IT & Corporate Domain)
In modern remote, hybrid, and in-office IT setups, organizations require complete visibility over digital assets and human resources:
* **Real-time Productivity Auditing:** Managers can monitor active applications, idle vs. productive hours, and browser navigation histories in real-time.
* **Non-Intrusive Background Telemetry:** IT supervisors can monitor resource spikes, unapproved background software, and system health without interrupting employee workstations or disrupting active user focus.
* **Tamper-Proof Audit Trail:** Comprehensive event logging records timestamps of user logins, software launches, file downloads, and USB/external device insertions.

### B. Parental Safety & Smart Child Supervision (Consumer & Home Domain)
Modern parents struggle with protecting minors from inappropriate digital content and screen addiction:
* **Activity Oversight:** Real-time visibility into digital interactions, active games, streaming apps, and browser tabs.
* **Privacy-First Architecture:** Unlike third-party commercial parental apps that monetize or leak sensitive telemetry on public clouds, ZENVORA keeps data private, self-hosted, or direct peer-to-peer encrypted.
* **Granular Rule Enforcement:** Ability to remotely freeze distracted screens, close unauthorized applications, and enforce study hours.

### C. Educational & Accessible Remote Administration (Junior Tech / Admin Onboarding)
Beginners and budding cybersecurity/IT students often find advanced administrative tools and remote deployment extremely intimidating:
* **Zero-Friction Networking:** Removes the friction of complex port forwarding, reverse SSH tunnels, or CLI payload generation.
* **Safe Educational Lab:** Provides aspiring IT engineers and junior system admins with an intuitive graphical interface to learn operating system internals, remote process lifecycles, and terminal administration safely.

---

## 3. Comprehensive Market & Competitive Analysis

| Evaluation Metric | Traditional Remote Desktop (AnyDesk, TeamViewer) | Advanced CLI / Framework Tools (Metasploit, Custom RATs) | Commercial Parental Monitoring Apps | **ZENVORA Platform (This FYP)** |
| :--- | :--- | :--- | :--- | :--- |
| **Active Screen Streaming & Control** | Full GUI Screen Control | Extremely limited / None / Static screen grabs | Static periodically scheduled screenshots | **Ultra-low Latency Real-time Stream & Input Control** |
| **Background Administrative Management** | **No** (Session must be active on user screen) | Yes (Deep low-level OS access) | **No** (Limited to telemetry logging) | **Yes (Process manager, background CLI terminal, services)** |
| **Ease of Use / Learning Curve** | Very Easy | Very Hard (Requires advanced networking & CLI knowledge) | Moderate (Mobile app interfaces) | **Very Easy (Unified web-based cockpit)** |
| **Remote Shell & Software Installation** | **No** (Must manually do it on user screen) | Yes (CLI commands) | **No** (Strict sandbox, no deep terminal access) | **Yes (Remote PowerShell/Bash shell & background installer)** |
| **AI Insights & Behavior Analysis** | **No** | **No** | Basic static keyword filters | **Yes (Smart anomaly detection, productivity metrics)** |
| **Data Privacy & Server Ownership** | Proprietary corporate servers | User controlled / Raw network | **High Risk:** Data hosted on 3rd-party vendor cloud | **Full Data Sovereignty:** Self-hosted DB with AES-256 E2EE |
| **Pricing & Accessibility** | Expensive recurring commercial tier | Free/Open-source (Complex) | Monthly paid subscriptions | **Open, Accessible & Modular Academic Architecture** |

### Detailed Edge Over Existing Solutions:
1. **AnyDesk & TeamViewer Limitations:**
   - Designed strictly for interactive GUI collaboration. If an administrator needs to terminate a hung service, install software via terminal, or inspect memory without hijacking the screen, AnyDesk fails completely. ZENVORA allows simultaneous active screen control *plus* discrete background terminal control.
2. **Metasploit / Payload / RAT Limitations:**
   - These tools are purely technical, terminal-driven, lack friendly visual dashboards, and require extensive knowledge of network sockets, NAT traversal, and low-level commands. ZENVORA democratizes remote systems control into a point-and-click modern responsive web console.
3. **Commercial Parental Software Insecurities:**
   - Mainstream parental control platforms charge exorbitant recurring fees, frequently suffer data breaches, and expose children's browsing habits and webcams to cloud vulnerabilities. ZENVORA enforces local database encryption and point-to-point authentication with no third-party data broker reliance.

---

## 4. Key System Features & Functional Modules

### 1. Unified Cockpit & Fleet Management
* Real-time grid of all connected endpoints (workstations, laptops, mobile clients).
* Online/offline heartbeat detection with dynamic IP, OS version, hardware specifications, and battery/uptime indicators.

### 2. Dual-Engine Remote Desktop (Display & Input)
* **Real-time Streaming:** Low latency video streaming over secure WebSockets / WebRTC.
* **Remote Interaction:** Mouse click, drag-and-drop, keyboard input injection, and display scaling.
* **Privacy Curtain / Blank Screen Mode:** Ability to blank out client monitors during administrative maintenance.

### 3. Background Deep-OS Controller (Non-Intrusive)
* **Live Task Manager:** View all running OS processes, CPU%, Memory utilization, and terminate unresponsive or blacklisted tasks.
* **Remote Interactive Shell:** Full-duplex interactive terminal (PowerShell, CMD, Bash) running in the background without opening a command window on the target screen.
* **Package & Application Deployment:** Remotely deploy scripts, run updates, and install or remove enterprise software silently.

### 4. Employee & Activity Telemetry Engine
* **Application Usage Breakdown:** Accurate time-tracking per application (e.g., Visual Studio: 4.5h, Chrome: 2.1h, Social Media: 0.2h).
* **Active vs. Idle Detection:** Tracks mouse/keyboard events to differentiate between productive workstation engagement and away-from-keyboard idle time.
* **Web Navigation Logging:** Categorized URL history and domain auditing.

### 5. AI-Assisted Diagnostics & Safety Engine
* **Productivity Scoring:** Automated categorization of applications into *Productive*, *Neutral*, or *Distracting* based on department roles.
* **Anomaly Detection:** Flags unexpected off-hour logins, rapid file modifications, or abnormal background resource spikes.
* **Parental Smart Filters:** Real-time analysis of active window titles and search queries with instant push alerts for unsafe material.

### 6. Security, Encryption & Access Control
* **Cryptographic Security:** End-to-End Encryption (AES-256-GCM) for data payloads and TLS for WebSocket streaming.
* **Role-Based Access Control (RBAC):**
  - *Super Admin:* Full system configuration, agent creation, remote terminal.
  - *Team Manager:* View employee metrics, screen streaming, productivity reports.
  - *Parent / Home Supervisor:* Child device oversight, screen limits, app blocker.

---

## 5. Application Pages & UI Breakdown

1. **Authentication & Identity Page (`/login`, `/register`):**
   - Secure multi-factor authentication (MFA).
   - Role selection (Enterprise Admin, Office Manager, Home Guardian).

2. **Main Dashboard / Fleet Overview (`/dashboard`):**
   - High-level metric cards: Total Registered Nodes, Active Connected Agents, Critical Alerts, Overall Productivity Score.
   - Interactive fleet table with quick-action triggers (Connect, Terminate, Terminal, Inspect).

3. **Live Desktop Control View (`/remote-control/[id]`):**
   - Fluid full-screen canvas streaming remote feed.
   - Quick floating toolbar: Resolution switch, Send Ctrl+Alt+Del, Clipboard sync, Audio toggle, Screen recorder.

4. **Background System Diagnostics (`/diagnostics/[id]`):**
   - **Tab 1: Process Explorer:** Sortable table of running PIDs, memory usage, CPU load, and one-click "Kill Process".
   - **Tab 2: Web Terminal:** Sleek, dark-themed xterm.js terminal emulator directly piping remote shell I/O.
   - **Tab 3: File System & App Installer:** Remote directory tree with drag-and-drop file upload and remote installation runner.

5. **Analytics & Productivity Reports (`/reports`):**
   - Visual time-series charts displaying active hours, top utilized programs, and domain frequency graphs.
   - Exportable PDF / CSV reports for corporate payroll auditing and HR evaluations.

6. **Parental & Policy Enforcement Settings (`/policies`):**
   - Blacklist/Whitelist website rules, scheduled bedtime lockouts, and instant screen freeze controls.

---

## 6. Technical Architecture & Implementation Stack

* **Frontend Dashboard:** Next.js (React 19), TypeScript, Tailwind CSS, Lucide Icons, Recharts (visual data).
* **Backend Gateway & Signaling Server:** Node.js, Express / Fastify, Socket.io / WebSocket Server.
* **Client Agent (Target Node):**
  - **Desktop:** Python (Cross-platform) / C# (.NET Core) with Windows API bindings (`pywin32`, `psutil`, `mss` for high-FPS screen capture).
  - **Mobile:** Kotlin / Android Native accessibility service for mobile telemetry.
* **Database & Storage:** PostgreSQL / MongoDB for state persistence, encrypted session keys, and telemetry logs.
* **Data Transmission Protocol:** WebSocket binary streams for terminal and low-level telemetry; WebRTC data channels for low-latency video feed.

---

## 7. Ethical, Legal, and Privacy Guardrails

To meet academic standards and FYP board requirements:
* **Consent & Transparency:** Client software operates with explicit configuration; corporate deployments show notifications informing employees of active administrative telemetry.
* **No Unsanctioned Exploits:** Unlike offensive tools (Metasploit/Trojan RATs), ZENVORA operates as an authorized management agent using legitimate system APIs, strict authentication tokens, and audit logging.
* **GDPR & Data Protection Alignment:** User telemetry is retained according to configurable retention windows, with one-click data purge options to protect individual digital rights.

---

## 8. Conclusion
**ZENVORA** unites remote visual support, granular background systems administration, and intelligent telemetry into an intuitive and accessible platform. By combining the best aspects of remote screen control with deep background diagnostic tools and AI analytics, it empowers enterprises with employee oversight, provides families with safe digital guardianship, and equips students with a transparent, easy-to-use platform for mastering remote system administration.
