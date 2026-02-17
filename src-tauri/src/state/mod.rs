use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Shared plan step type used across commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: u32,
    pub description: String,
    pub status: String,
}

/// Shared plan type used across commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub steps: Vec<PlanStep>,
    pub current_step: Option<u32>,
    pub status: String,
    pub status_message: Option<String>,
}

/// Shared source reference type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub doc: String,
    pub page: Option<u32>,
}

/// Parse a Plan from a JSON Value.
pub fn parse_plan(value: &Value) -> Option<Plan> {
    if !value.is_object() {
        return None;
    }

    let steps: Vec<PlanStep> = value["steps"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|s| {
            Some(PlanStep {
                id: s["id"].as_u64()? as u32,
                description: s["description"].as_str()?.to_string(),
                status: s["status"].as_str()?.to_string(),
            })
        })
        .collect();

    Some(Plan {
        steps,
        current_step: value["current_step"].as_u64().map(|s| s as u32),
        status: value["status"].as_str().unwrap_or("completed").to_string(),
        status_message: value["status_message"].as_str().map(|s| s.to_string()),
    })
}

/// Parse sources from a JSON array.
pub fn parse_sources(value: &Value) -> Option<Vec<SourceRef>> {
    value.as_array().map(|arr| {
        arr.iter()
            .filter_map(|s| {
                Some(SourceRef {
                    doc: s["doc"].as_str()?.to_string(),
                    page: s["page"].as_u64().map(|p| p as u32),
                })
            })
            .collect()
    })
}

/// Parse pinned docs from a JSON array.
pub fn parse_pinned_docs(value: &Value) -> Option<Vec<String>> {
    value.as_array().map(|arr| {
        arr.iter()
            .filter_map(|p| p.as_str().map(|s| s.to_string()))
            .collect()
    })
}
