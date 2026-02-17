use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: String,
    pub doc_path: String,
    pub content: String,
    pub score: f64,
    pub page_number: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub total: u32,
}

#[tauri::command]
pub async fn search(
    workspace_id: String,
    query: String,
    pinned_docs: Option<Vec<String>>,
    app_handle: tauri::AppHandle,
    sidecar: State<'_, crate::sidecar::manager::SidecarManager>,
) -> Result<SearchResponse, String> {
    sidecar.start(app_handle.clone()).await?;
    
    let params = serde_json::json!({
        "workspace_id": workspace_id,
        "query": query,
        "pinned_docs": pinned_docs,
        "top_k": 15
    });
    
    let response = sidecar.call(app_handle, "search", params).await?;
    
    let results: Vec<SearchResult> = response["results"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|r| {
            Some(SearchResult {
                chunk_id: r["chunk_id"].as_str()?.to_string(),
                doc_path: r["doc_path"].as_str()?.to_string(),
                content: r["content"].as_str()?.to_string(),
                score: r["score"].as_f64().unwrap_or(0.0),
                page_number: r["page_number"].as_u64().map(|p| p as u32),
            })
        })
        .collect();
    
    Ok(SearchResponse {
        results,
        total: response["total"].as_u64().unwrap_or(0) as u32,
    })
}

