use serde::{Deserialize, Serialize};
use tauri::State;

use crate::sidecar::manager::SidecarManager;
use crate::state::{Plan, SourceRef, parse_plan, parse_sources, parse_pinned_docs};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationInfo {
    pub id: String,
    pub workspace_id: String,
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub last_message_at: Option<String>,
    pub preview: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageInfo {
    pub id: String,
    pub role: String,
    pub content: String,
    pub sources: Option<Vec<SourceRef>>,
    pub pinned_docs: Option<Vec<String>>,
    pub plan: Option<Plan>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationWithMessages {
    pub id: String,
    pub workspace_id: String,
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub last_message_at: Option<String>,
    pub messages: Vec<MessageInfo>,
}

#[tauri::command]
pub async fn create_conversation(
    workspace_id: String,
    title: Option<String>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<ConversationInfo, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "title": title
    });
    
    let response = sidecar.call(app_handle, "conversation_create", params).await?;
    
    Ok(ConversationInfo {
        id: response["id"].as_str().ok_or("Invalid response")?.to_string(),
        workspace_id: response["workspace_id"].as_str().unwrap_or("").to_string(),
        title: response["title"].as_str().map(|s| s.to_string()),
        created_at: None,
        last_message_at: None,
        preview: None,
    })
}

#[tauri::command]
pub async fn list_conversations(
    workspace_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<Vec<ConversationInfo>, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id
    });
    
    let response = sidecar.call(app_handle, "conversation_list", params).await?;
    
    let conversations = response["conversations"]
        .as_array()
        .ok_or("Invalid response")?
        .iter()
        .map(|c| ConversationInfo {
            id: c["id"].as_str().unwrap_or("").to_string(),
            workspace_id: c["workspace_id"].as_str().unwrap_or("").to_string(),
            title: c["title"].as_str().map(|s| s.to_string()),
            created_at: c["created_at"].as_str().map(|s| s.to_string()),
            last_message_at: c["last_message_at"].as_str().map(|s| s.to_string()),
            preview: c["preview"].as_str().map(|s| s.to_string()),
        })
        .collect();
    
    Ok(conversations)
}

#[tauri::command]
pub async fn get_conversation(
    workspace_id: String,
    conversation_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<ConversationWithMessages, String> {
    sidecar.start(app_handle.clone()).await?;
    
    // Get metadata from SQLite
    let meta_params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id.clone()
    });
    let meta_response = sidecar.call(app_handle.clone(), "conversation_get", meta_params).await?;
    
    // Get history from LangGraph
    let hist_params = serde_json::json!({
        "conversation_id": conversation_id
    });
    let hist_response = sidecar.call(app_handle, "conversation_history", hist_params).await?;
    
    let messages = hist_response["messages"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| MessageInfo {
                    id: m["id"].as_str().unwrap_or("").to_string(),
                    role: m["role"].as_str().unwrap_or("user").to_string(),
                    content: m["content"].as_str().unwrap_or("").to_string(),
                    sources: None,
                    pinned_docs: None,
                    plan: None,
                    timestamp: m["timestamp"].as_str().map(|s| s.to_string()),
                })
                .collect()
        })
        .unwrap_or_else(Vec::new);

    // Extract conversation data from the nested structure
    let conversation = meta_response["conversation"].as_object()
        .ok_or("Invalid response: missing conversation object")?;
    
    Ok(ConversationWithMessages {
        id: conversation["id"].as_str().ok_or("Invalid response: missing id")?.to_string(),
        workspace_id: conversation["workspace_id"].as_str().unwrap_or("").to_string(),
        title: conversation["title"].as_str().map(|s| s.to_string()),
        created_at: conversation["created_at"].as_str().map(|s| s.to_string()),
        last_message_at: conversation["last_message_at"].as_str().map(|s| s.to_string()),
        messages,
    })
}

#[tauri::command]
pub async fn delete_conversation(
    workspace_id: String,
    conversation_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<(), String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id
    });
    
    sidecar.call(app_handle, "conversation_delete", params).await?;
    
    Ok(())
}

#[tauri::command]
pub async fn add_message(
    workspace_id: String,
    conversation_id: String,
    role: String,
    content: String,
    sources: Option<Vec<SourceRef>>,
    pinned_docs: Option<Vec<String>>,
    plan: Option<Plan>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<MessageInfo, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "sources": sources,
        "pinned_docs": pinned_docs,
        "plan": plan
    });
    
    let response = sidecar.call(app_handle, "conversation_add_message", params).await?;
    
    Ok(MessageInfo {
        id: response["id"].as_str().ok_or("Invalid response")?.to_string(),
        role: response["role"].as_str().unwrap_or("user").to_string(),
        content: response["content"].as_str().unwrap_or("").to_string(),
        sources: parse_sources(&response["sources"]),
        pinned_docs: parse_pinned_docs(&response["pinned_docs"]),
        plan: parse_plan(&response["plan"]),
        timestamp: None,
    })
}

#[tauri::command]
pub async fn update_conversation_title(
    workspace_id: String,
    conversation_id: String,
    title: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<(), String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "title": title
    });
    
    sidecar.call(app_handle, "conversation_update_title", params).await?;
    
    Ok(())
}
