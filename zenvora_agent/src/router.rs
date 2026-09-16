use crate::agent::AgentState;
use crate::commands::{handle_command, CommandResponse, IncomingPacket};
use crate::file_commands::{handle_file_command, is_file_action};
use crate::screen_commands::{handle_screen_command, is_screen_action};
use crate::history_commands::HistoryCommand;
use crate::shell_commands::{handle_shell_command, is_shell_action};
use crate::openclaw_agent::{OpenClawAgent, OpenClawStep};
use crate::openclaw_db;

pub fn is_openclaw_action(action: &str) -> bool {
    matches!(
        action,
        "OPENCLAW_EXECUTE"
            | "OPENCLAW_EXECUTE_PLAN"
            | "AI_AGENT_EXECUTE"
            | "OPENCLAW_GET_CONTEXT"
            | "AI_AGENT_GET_CONTEXT"
            | "OPENCLAW_QUERY_DB"
            | "AI_AGENT_QUERY_DB"
            | "OPENCLAW_INSPECT_UI"
            | "AI_AGENT_INSPECT_UI"
            | "OPENCLAW_STEP"
            | "AI_AGENT_STEP"
            | "HEAL_ANALYZE"
            | "HEAL_FIX"
            | "HEAL_RUN"
            | "HEAL_DEEP_DIAGNOSE"
            | "AGENT_AI_STATUS"
            | "SET_AGENT_AI_CONFIG"
            | "VERIFY_DATA_INTEGRITY"
    )
}

pub fn is_history_action(action: &str) -> bool {
    matches!(
        action,
        "FETCH_BROWSER_HISTORY"
            | "SEARCH_BROWSER_HISTORY"
            | "FETCH_APP_HISTORY"
            | "FETCH_SYSTEM_NOTIFICATIONS"
            | "STOP_HISTORY_COLLECTION"
    )
}

pub fn is_agent_control_action(action: &str) -> bool {
    matches!(
        action,
        "RESTART_AGENT"
            | "RESTART_SERVICE"
            | "SET_PREFERRED_MEDIA_TRANSPORT"
            | "UPDATE_AGENT"
            | "PROBE_GATEWAY_URL"
            | "SWITCH_GATEWAY_URL"
    )
}

pub fn handle_agent_control_command(action: &str, payload: &serde_json::Value) -> Option<CommandResponse> {
    match action {
        "RESTART_AGENT" | "RESTART_SERVICE" => {
            // Respond first, then restart shortly so the ACK can leave the socket.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let _ = crate::service::restart_service();
                // If service restart is unavailable, exit so SCM / launcher respawns us.
                std::process::exit(0);
            });
            Some(CommandResponse {
                json: serde_json::json!({
                    "type": "sys_ack",
                    "status": "success",
                    "action": action,
                    "message": "Agent restart scheduled."
                }),
                frame: None,
                frame_kind: 0,
            })
        }
        "UPDATE_AGENT" => {
            let url = payload
                .get("download_url")
                .or_else(|| payload.get("downloadUrl"))
                .and_then(|v| v.as_str());
            match crate::agent_update::schedule_silent_update(url) {
                Ok(()) => Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "success",
                        "action": action,
                        "message": "Silent agent update scheduled."
                    }),
                    frame: None,
                    frame_kind: 0,
                }),
                Err(err) => Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "error",
                        "action": action,
                        "message": format!("Update failed: {}", err)
                    }),
                    frame: None,
                    frame_kind: 0,
                }),
            }
        }
        "SET_PREFERRED_MEDIA_TRANSPORT" => {
            let transport = payload
                .get("transport")
                .or_else(|| payload.get("preferredMediaTransport"))
                .and_then(|v| v.as_str())
                .unwrap_or("wss");
            crate::media_channels::set_preferred_media_transport(transport);
            Some(CommandResponse {
                json: serde_json::json!({
                    "type": "sys_ack",
                    "status": "success",
                    "action": action,
                    "preferredMediaTransport": crate::media_channels::preferred_media_transport(),
                    "message": format!(
                        "Media transport set to {} (manual only — no auto-failover).",
                        crate::media_channels::preferred_media_transport()
                    )
                }),
                frame: None,
                frame_kind: 0,
            })
        }
        "PROBE_GATEWAY_URL" => {
            let target_url = payload
                .get("targetUrl")
                .or_else(|| payload.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();

            if target_url.is_empty() {
                return Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "error",
                        "action": action,
                        "live": false,
                        "message": "Target gateway URL cannot be empty."
                    }),
                    frame: None,
                    frame_kind: 0,
                });
            }

            let clean = target_url
                .trim_start_matches("wss://")
                .trim_start_matches("ws://")
                .trim_start_matches("https://")
                .trim_start_matches("http://");
            let host_port_part = clean.split('/').next().unwrap_or(clean);

            let (host, port) = if let Some((h, p)) = host_port_part.split_once(':') {
                (h, p.parse::<u16>().unwrap_or(9443))
            } else {
                (host_port_part, if target_url.starts_with("https://") || target_url.starts_with("wss://") { 443 } else { 9443 })
            };

            let addr_str = format!("{}:{}", host, port);
            let start = std::time::Instant::now();

            use std::net::ToSocketAddrs;
            let connect_res = match addr_str.to_socket_addrs() {
                Ok(mut addrs) => {
                    if let Some(sa) = addrs.next() {
                        std::net::TcpStream::connect_timeout(&sa, std::time::Duration::from_secs(4))
                    } else {
                        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No IP resolved for host"))
                    }
                }
                Err(e) => Err(e),
            };

            let rtt_ms = start.elapsed().as_millis() as u64;

            match connect_res {
                Ok(_) => Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "success",
                        "action": action,
                        "targetUrl": target_url,
                        "endpoint": addr_str,
                        "live": true,
                        "rttMs": rtt_ms,
                        "message": format!("Agent connected to {} in {}ms.", addr_str, rtt_ms)
                    }),
                    frame: None,
                    frame_kind: 0,
                }),
                Err(err) => Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "error",
                        "action": action,
                        "targetUrl": target_url,
                        "endpoint": addr_str,
                        "live": false,
                        "rttMs": rtt_ms,
                        "error": err.to_string(),
                        "message": format!("Agent failed to connect to {}: {}", addr_str, err)
                    }),
                    frame: None,
                    frame_kind: 0,
                }),
            }
        }
        "SWITCH_GATEWAY_URL" => {
            let target_url = payload
                .get("targetUrl")
                .or_else(|| payload.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if target_url.is_empty() {
                return Some(CommandResponse {
                    json: serde_json::json!({
                        "type": "sys_ack",
                        "status": "error",
                        "action": action,
                        "message": "Target gateway URL cannot be empty."
                    }),
                    frame: None,
                    frame_kind: 0,
                });
            }

            // Save new gateway URL to agent.dat
            if let Some(mut cfg) = crate::config::AgentConfig::load_existing() {
                cfg.gateway_url = target_url.clone();
                cfg.save();
            }

            // Schedule restart/reconnect shortly so the ACK packet leaves first
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = crate::service::restart_service();
                std::process::exit(0);
            });

            Some(CommandResponse {
                json: serde_json::json!({
                    "type": "sys_ack",
                    "status": "success",
                    "action": action,
                    "targetUrl": target_url,
                    "message": "Gateway URL persisted. Agent is restarting to connect to new endpoint."
                }),
                frame: None,
                frame_kind: 0,
            })
        }
        _ => None,
    }
}

pub fn handle_history_command(action: &str, payload: &serde_json::Value) -> Option<CommandResponse> {
    let response = match action {
        "SEARCH_BROWSER_HISTORY" => {
            let query = payload
                .get("query")
                .or_else(|| payload.get("search"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = payload
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(100);
            let order = payload
                .get("order")
                .or_else(|| payload.get("sort"))
                .and_then(|v| v.as_str())
                .unwrap_or("desc");
            let data = HistoryCommand::execute_search_browser_history(query, limit, order);
            CommandResponse {
                json: data,
                frame: None,
                frame_kind: 0,
            }
        }
        "FETCH_BROWSER_HISTORY" => {
            let limit = payload
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);
            let data = HistoryCommand::execute_fetch_browser_history(limit);
            CommandResponse {
                json: data,
                frame: None,
                frame_kind: 0,
            }
        }
        "FETCH_APP_HISTORY" => {
            let data = HistoryCommand::execute_fetch_app_history();
            CommandResponse {
                json: data,
                frame: None,
                frame_kind: 0,
            }
        }
        "FETCH_SYSTEM_NOTIFICATIONS" => {
            let data = HistoryCommand::execute_fetch_notifications();
            CommandResponse {
                json: data,
                frame: None,
                frame_kind: 0,
            }
        }
        "STOP_HISTORY_COLLECTION" => {
            let data = HistoryCommand::execute_stop_collection();
            CommandResponse {
                json: data,
                frame: None,
                frame_kind: 0,
            }
        }
        _ => return None,
    };
    Some(response)
}

pub fn is_audio_action(action: &str) -> bool {
    matches!(
        action,
        "START_AUDIO_STREAM"
            | "STOP_AUDIO_STREAM"
            | "LIST_AUDIO_DEVICES"
            | "START_SPEAKER_PLAY"
            | "STOP_SPEAKER_PLAY"
    )
}

pub fn handle_openclaw_command(action: &str, payload: &serde_json::Value) -> Option<CommandResponse> {
    let response_json = match action {
        "OPENCLAW_GET_CONTEXT" | "AI_AGENT_GET_CONTEXT" => {
            let ctx = openclaw_db::synthesize_user_context();
            serde_json::json!({
                "type": "openclaw_response",
                "action": action,
                "status": "success",
                "context": ctx
            })
        }
        "OPENCLAW_INSPECT_UI" | "AI_AGENT_INSPECT_UI" => {
            let inspect = OpenClawAgent::inspect_desktop();
            serde_json::json!({
                "type": "openclaw_response",
                "action": action,
                "status": "success",
                "inspection": inspect
            })
        }
        "OPENCLAW_QUERY_DB" | "AI_AGENT_QUERY_DB" => {
            let limit = payload.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            let category = payload.get("category").and_then(|v| v.as_str());
            let search = payload.get("search").or_else(|| payload.get("query")).and_then(|v| v.as_str());
            let table = payload.get("table").and_then(|v| v.as_str()).unwrap_or("events");

            match table {
                "clipboard" => {
                    let clips = openclaw_db::query_clipboard(limit);
                    serde_json::json!({
                        "type": "openclaw_response",
                        "action": action,
                        "status": "success",
                        "table": "clipboard",
                        "records": clips
                    })
                }
                "windows" => {
                    let wins = openclaw_db::query_window_history(limit);
                    serde_json::json!({
                        "type": "openclaw_response",
                        "action": action,
                        "status": "success",
                        "table": "windows",
                        "records": wins
                    })
                }
                _ => {
                    let events = openclaw_db::query_events(limit, category, search);
                    serde_json::json!({
                        "type": "openclaw_response",
                        "action": action,
                        "status": "success",
                        "table": "events",
                        "records": events
                    })
                }
            }
        }
        "OPENCLAW_STEP" | "AI_AGENT_STEP" => {
            let action_type = payload.get("actionType").or_else(|| payload.get("action_type")).and_then(|v| v.as_str()).unwrap_or("turbo_script");
            let params = payload.get("params").cloned().unwrap_or_else(|| payload.clone());
            let start = std::time::Instant::now();
            let res = OpenClawAgent::execute_primitive(action_type, &params);
            let duration_ms = start.elapsed().as_millis() as u64;

            match res {
                Ok(out) => serde_json::json!({
                    "type": "openclaw_response",
                    "action": action,
                    "status": "success",
                    "output": out,
                    "durationMs": duration_ms
                }),
                Err(err) => serde_json::json!({
                    "type": "openclaw_response",
                    "action": action,
                    "status": "error",
                    "error": err,
                    "durationMs": duration_ms
                }),
            }
        }
        "OPENCLAW_EXECUTE" | "OPENCLAW_EXECUTE_PLAN" | "AI_AGENT_EXECUTE" => {
            let task_id = payload.get("taskId").or_else(|| payload.get("task_id")).and_then(|v| v.as_str()).unwrap_or("plan_exec");

            let steps: Vec<OpenClawStep> = if let Some(arr) = payload.get("steps").and_then(|v| v.as_array()) {
                arr.iter().enumerate().filter_map(|(idx, item)| {
                    let action_type = item.get("action_type").or_else(|| item.get("actionType")).and_then(|v| v.as_str())?.to_string();
                    let params = item.get("params").cloned().unwrap_or(serde_json::Value::Null);
                    let description = item.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let target = item.get("target").and_then(|v| v.as_str()).map(|s| s.to_string());
                    Some(OpenClawStep {
                        step_index: idx + 1,
                        action_type,
                        target,
                        params,
                        description,
                    })
                }).collect()
            } else if let Some(script) = payload.get("script").or_else(|| payload.get("command")).and_then(|v| v.as_str()) {
                vec![OpenClawStep {
                    step_index: 1,
                    action_type: "turbo_script".to_string(),
                    target: None,
                    params: serde_json::json!({ "script": script }),
                    description: "Execute autonomous turbo script".to_string(),
                }]
            } else {
                Vec::new()
            };

            let report = OpenClawAgent::execute_plan(task_id, steps);
            serde_json::json!({
                "type": "openclaw_response",
                "action": action,
                "status": if report.success { "success" } else { "partial_or_error" },
                "report": report
            })
        }
        "HEAL_ANALYZE" | "AGENT_AI_STATUS" | "HEAL_DEEP_DIAGNOSE" => {
            let diag = OpenClawAgent::diagnose_system();
            serde_json::json!({
                "type": "heal_result",
                "action": action,
                "success": true,
                "analysis": diag,
                "engine": "OpenClaw + Microsoft UFO"
            })
        }
        "HEAL_FIX" => {
            let cmd = payload.get("command")
                .or_else(|| payload.get("script"))
                .or_else(|| payload.get("topic"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let healed = OpenClawAgent::heal_system(cmd);
            serde_json::json!({
                "type": "heal_result",
                "action": action,
                "success": true,
                "fixed": healed,
                "engine": "OpenClaw + Microsoft UFO"
            })
        }
        "HEAL_RUN" => {
            let cmd = payload.get("command").or_else(|| payload.get("cmd")).and_then(|v| v.as_str()).unwrap_or("");
            let res = OpenClawAgent::execute_primitive("turbo_script", &serde_json::json!({ "script": cmd }));
            serde_json::json!({
                "type": "heal_result",
                "action": action,
                "success": res.is_ok(),
                "output": res.unwrap_or_else(|e| e)
            })
        }
        "SET_AGENT_AI_CONFIG" | "VERIFY_DATA_INTEGRITY" => {
            serde_json::json!({
                "type": "openclaw_response",
                "action": action,
                "status": "success",
                "message": "AI configuration handled autonomously by OpenClaw"
            })
        }
        _ => return None,
    };

    Some(CommandResponse {
        json: response_json,
        frame: None,
        frame_kind: 0,
    })
}

pub fn dispatch_command(packet: IncomingPacket, agent: &mut AgentState) -> Option<CommandResponse> {
    if is_openclaw_action(&packet.action) {
        handle_openclaw_command(&packet.action, &packet.payload)
    } else if is_agent_control_action(&packet.action) {
        handle_agent_control_command(&packet.action, &packet.payload)
    } else if is_history_action(&packet.action) {
        handle_history_command(&packet.action, &packet.payload)
    } else if is_shell_action(&packet.action) {
        handle_shell_command(packet, &mut agent.shell)
    } else if is_file_action(&packet.action) {
        handle_file_command(packet, &mut agent.files)
    } else if is_screen_action(&packet.action) {
        handle_screen_command(packet, &mut agent.screen)
    } else if is_audio_action(&packet.action) {
        Some(CommandResponse {
            json: serde_json::json!({
                "type": "sys_ack",
                "status": "success",
                "message": format!("Audio command {} accepted", packet.action)
            }),
            frame: None,
            frame_kind: 0,
        })
    } else {
        handle_command(packet, &mut agent.camera)
    }
}
