use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::sidecar::manager::SidecarManager;

/// Shared state to hold the file path to preview
pub struct PreviewRequest {
    pub file_path: Mutex<Option<String>>,
}

impl PreviewRequest {
    pub fn new() -> Self {
        Self {
            file_path: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentContent {
    pub content: String,
    pub file_type: String,
    pub filename: String,
    pub can_preview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveDocumentDraft {
    pub id: String,
    pub conversation_id: String,
    pub filename: String,
    pub content: String,
    pub location: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveDocumentResponse {
    pub relative_path: String,
    pub filename: String,
    pub location: String,
    pub format: String,
    pub fallback_to_md: bool,
    pub indexing_queued: bool,
    pub message: String,
}

/// Set the file path to preview (workaround for parameter passing issues)
#[tauri::command]
pub fn set_preview_path(state: State<'_, PreviewRequest>, path: String) -> Result<(), String> {
    let mut file_path = state.file_path.lock().map_err(|e| e.to_string())?;
    *file_path = Some(path);
    Ok(())
}

/// Read the document that was set via set_preview_path
#[tauri::command]
pub async fn get_preview_content(
    state: State<'_, PreviewRequest>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<DocumentContent, String> {
    let path_str = {
        let file_path = state.file_path.lock().map_err(|e| e.to_string())?;
        file_path
            .as_ref()
            .ok_or("No file path set. Call set_preview_path first.")?
            .clone()
    };
    
    let path = PathBuf::from(&path_str);
    
    if !path.exists() {
        return Err(format!("File not found: {}", path_str));
    }
    
    if !path.is_file() {
        return Err(format!("Not a file: {}", path_str));
    }
    
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    // Handle text-based files directly in Rust (fast path)
    match extension.as_str() {
        "txt" | "md" | "markdown" | "json" | "html" => {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            
            Ok(DocumentContent {
                content,
                file_type: extension,
                filename,
                can_preview: true,
            })
        }
        "pdf" | "docx" => {
            // Binary formats - delegate to Node.js sidecar for parsing
            sidecar.start(app_handle.clone()).await?;
            
            let params = serde_json::json!({
                "path": path_str
            });
            
            let response = sidecar.call(app_handle, "document_preview", params).await?;
            
            Ok(DocumentContent {
                content: response["content"].as_str().unwrap_or("").to_string(),
                file_type: response["file_type"].as_str().unwrap_or(&extension).to_string(),
                filename: response["filename"].as_str().unwrap_or(&filename).to_string(),
                can_preview: response["can_preview"].as_bool().unwrap_or(true),
            })
        }
        _ => {
            Err(format!("Unsupported file type: .{}", extension))
        }
    }
}

#[tauri::command]
pub async fn get_active_document_draft(
    workspace_id: String,
    conversation_id: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<Option<ActiveDocumentDraft>, String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id
    });

    let response = sidecar.call(app_handle, "document_get_active_draft", params).await?;
    let draft = &response["draft"];
    if draft.is_null() {
        return Ok(None);
    }

    Ok(Some(ActiveDocumentDraft {
        id: draft["id"].as_str().unwrap_or("").to_string(),
        conversation_id: draft["conversation_id"].as_str().unwrap_or("").to_string(),
        filename: draft["filename"].as_str().unwrap_or("").to_string(),
        content: draft["content"].as_str().unwrap_or("").to_string(),
        location: draft["location"].as_str().unwrap_or("").to_string(),
        status: draft["status"].as_str().unwrap_or("active").to_string(),
        created_at: draft["created_at"].as_i64().unwrap_or_default(),
        updated_at: draft["updated_at"].as_i64().unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn discard_document_draft(
    workspace_id: String,
    conversation_id: String,
    draft_id: Option<String>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<(), String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "draft_id": draft_id
    });

    sidecar.call(app_handle, "document_discard_draft", params).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_document(
    workspace_id: String,
    conversation_id: String,
    draft_id: Option<String>,
    filename: String,
    content: String,
    location: String,
    format: String,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, SidecarManager>,
) -> Result<SaveDocumentResponse, String> {
    sidecar.start(app_handle.clone()).await?;

    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "draft_id": draft_id,
        "filename": filename,
        "content": content,
        "location": location,
        "format": format
    });

    let response = sidecar.call(app_handle, "document_save", params).await?;
    Ok(SaveDocumentResponse {
        relative_path: response["relative_path"].as_str().unwrap_or("").to_string(),
        filename: response["filename"].as_str().unwrap_or("").to_string(),
        location: response["location"].as_str().unwrap_or(".").to_string(),
        format: response["format"].as_str().unwrap_or("md").to_string(),
        fallback_to_md: response["fallback_to_md"].as_bool().unwrap_or(false),
        indexing_queued: response["indexing_queued"].as_bool().unwrap_or(false),
        message: response["message"].as_str().unwrap_or("").to_string(),
    })
}
