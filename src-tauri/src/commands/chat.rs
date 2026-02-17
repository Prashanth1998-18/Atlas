use serde::{Deserialize, Serialize};
use tauri::State;

use crate::sidecar::manager::SidecarManager;
use crate::state::{Plan, SourceRef, parse_plan, parse_sources};

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub response: String,
    pub sources: Vec<SourceRef>,
    pub plan: Option<Plan>,
}

#[tauri::command]
pub async fn chat(
    workspace_id: String,
    message: String,
    pinned_docs: Vec<String>,
    conversation_id: String,  // Required - LangGraph uses this as thread_id for memory
    is_retry: Option<bool>,
    is_edit: Option<bool>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<ChatResponse, String> {
    sidecar.start(app_handle.clone()).await?;

    let pinned_for_sidecar = if pinned_docs.is_empty() {
        None
    } else {
        Some(pinned_docs)
    };

    // LangGraph handles conversation history automatically via conversation_id (thread_id)
    // No need to pass conversation_history - the agent loads it from checkpoint
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "message": message,
        "pinned_docs": pinned_for_sidecar,
        "conversation_id": conversation_id,
        "is_retry": is_retry.unwrap_or(false),
        "is_edit": is_edit.unwrap_or(false),
    });

    let response = sidecar.call(app_handle, "chat", params).await?;

    Ok(ChatResponse {
        response: response["response"]
            .as_str()
            .ok_or("Invalid response")?
            .to_string(),
        sources: parse_sources(&response["sources"]).unwrap_or_default(),
        plan: parse_plan(&response["plan"]),
    })
}
