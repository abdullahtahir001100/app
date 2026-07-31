Place ZenvoraAgent.exe here after: cargo build --release (from zenvora_agent/).
This file must be committed and deployed — Railway has no Rust Windows build, so /api/agent/download 404s without it.
Optional: set AGENT_BINARY_PATH to an absolute path on the server.
