use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct RPCRequest {
    pub jsonrpc: String,
    pub id: String,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RPCResponse {
    pub jsonrpc: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RPCError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RPCError {
    pub code: i32,
    pub message: String,
}

// JSON-RPC types for Node.js sidecar communication
// The actual IPC is handled in manager.rs via stdin/stdout
