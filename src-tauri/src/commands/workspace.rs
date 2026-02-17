use serde::{Deserialize, Serialize};
use tauri::State;

use crate::sidecar::manager::SidecarManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub workspace_id: String,
    pub document_count: u32,
    pub indexed_count: u32,
    pub is_indexing: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceDocumentInfo {
    pub path: String,
    pub name: String,
    pub modified_at: Option<f64>,
    pub created_at: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceDirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
}

#[tauri::command]
pub async fn open_workspace(
    path: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<WorkspaceInfo, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "path": path
    });
    
    let response = sidecar.call(app_handle, "workspace_open", params).await?;
    
    Ok(WorkspaceInfo {
        workspace_id: response["workspace_id"]
            .as_str()
            .ok_or("Invalid response")?
            .to_string(),
        document_count: response["document_count"]
            .as_u64()
            .ok_or("Invalid response")? as u32,
        indexed_count: response["indexed_count"]
            .as_u64()
            .ok_or("Invalid response")? as u32,
        is_indexing: response["is_indexing"]
            .as_bool()
            .ok_or("Invalid response")?,
    })
}

#[tauri::command]
pub async fn close_workspace(
    workspace_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<(), String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id
    });
    
    // Call Node sidecar to close the workspace
    sidecar.call(app_handle, "workspace_close", params).await?;
    
    Ok(())
}

#[tauri::command]
pub async fn get_workspace_status(
    workspace_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<WorkspaceInfo, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id
    });
    
    let response = sidecar.call(app_handle, "workspace_status", params).await?;
    
    Ok(WorkspaceInfo {
        workspace_id,
        document_count: response["total_count"]
            .as_u64()
            .ok_or("Invalid response")? as u32,
        indexed_count: response["indexed_count"]
            .as_u64()
            .ok_or("Invalid response")? as u32,
        is_indexing: response["in_progress"]
            .as_bool()
            .ok_or("Invalid response")?,
    })
}

#[tauri::command]
pub async fn list_workspace_documents(
    workspace_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<Vec<WorkspaceDocumentInfo>, String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id
    });

    let response = sidecar.call(app_handle, "workspace_list_documents", params).await?;
    let documents = response["documents"]
        .as_array()
        .ok_or("Invalid response: missing documents")?
        .iter()
        .map(|d| WorkspaceDocumentInfo {
            path: d["path"].as_str().unwrap_or("").to_string(),
            name: d["name"].as_str().unwrap_or("").to_string(),
            modified_at: d["modified_at"].as_f64(),
            created_at: d["created_at"].as_f64(),
        })
        .collect();

    Ok(documents)
}

#[tauri::command]
pub async fn list_workspace_directory(
    workspace_id: String,
    directory_path: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<Vec<WorkspaceDirectoryEntry>, String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "directory_path": directory_path
    });

    let response = sidecar.call(app_handle, "workspace_list_directory", params).await?;
    let entries = response["entries"]
        .as_array()
        .ok_or("Invalid response: missing entries")?
        .iter()
        .map(|entry| WorkspaceDirectoryEntry {
            name: entry["name"].as_str().unwrap_or("").to_string(),
            path: entry["path"].as_str().unwrap_or("").to_string(),
            is_directory: entry["is_directory"].as_bool().unwrap_or(false),
            is_file: entry["is_file"].as_bool().unwrap_or(false),
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn read_workspace_file_bytes(
    workspace_id: String,
    file_path: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<String, String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "file_path": file_path
    });

    let response = sidecar.call(app_handle, "workspace_read_file_bytes", params).await?;
    let data = response["data_base64"]
        .as_str()
        .ok_or("Invalid response: missing data_base64")?
        .to_string();

    Ok(data)
}

