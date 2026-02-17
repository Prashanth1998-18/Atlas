use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Command as TokioCommand, Child as TokioChild};
use tauri::{AppHandle, Manager, Emitter};

pub struct SidecarManager {
    process: Arc<Mutex<Option<TokioChild>>>,
    // Use broadcast channel to send lines to any listeners
    line_tx: broadcast::Sender<String>,
}

impl SidecarManager {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            process: Arc::new(Mutex::new(None)),
            line_tx: tx,
        }
    }

    pub async fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        let mut process_guard = self.process.lock().await;
        
        if process_guard.is_some() {
            return Ok(()); // Already running
        }

        // Try bundled executable first (production), then fall back to Node source (dev)
        let mut child = if let Ok(bundled_exe) = Self::find_bundled_sidecar() {
            eprintln!("Starting bundled sidecar: {:?}", bundled_exe);
            TokioCommand::new(&bundled_exe)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("Failed to start bundled sidecar: {}", e))?
        } else {
            // Development mode - run Node from source
            let sidecar_path = Self::get_sidecar_path()?;
            
            #[cfg(windows)]
            let ts_node_cmd = "npx.cmd";
            #[cfg(not(windows))]
            let ts_node_cmd = "npx";

            eprintln!("Starting Node backend: npx tsx src/main.ts");
            TokioCommand::new(ts_node_cmd)
                .arg("tsx")
                .arg("src/main.ts")
                .current_dir(&sidecar_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("Failed to start sidecar: {}", e))?
        };

        let stdout = child.stdout.take().ok_or("Failed to take stdout")?;
        let tx = self.line_tx.clone();
        let app = app_handle.clone();

        // Spawn a task to read stdout line by line
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                // Send to internal broadcast channel for sync calls
                let _ = tx.send(line.clone());

                // Emit Tauri event for notifications/streaming
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if value.get("method").is_some() {
                        let _ = app.emit("sidecar-notification", value);
                    }
                }
            }
        });

        *process_guard = Some(child);
        Ok(())
    }
    
    fn find_bundled_sidecar() -> Result<PathBuf, String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        let exe_dir = exe_path.parent().ok_or("No parent directory")?;
        
        let sidecar_name = if cfg!(windows) {
            "node-backend.exe"
        } else {
            "node-backend"
        };
        
        // Check multiple possible locations for bundled sidecar
        let possible_paths = vec![
            exe_dir.join(sidecar_name),
            exe_dir.join("resources").join(sidecar_name),
            exe_dir.join("_up_").join("resources").join(sidecar_name),
            exe_dir.join("../Resources").join(sidecar_name),
        ];
        
        for path in possible_paths {
            if path.exists() {
                return Ok(path);
            }
        }
        
        Err("Bundled sidecar not found".to_string())
    }
    
    fn get_sidecar_path() -> Result<PathBuf, String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        eprintln!("Executable path: {:?}", exe_path);
        
        if cfg!(debug_assertions) {
            // In debug mode, exe is at: target/debug/atlas.exe
            // Project root is: target/debug -> target -> src-tauri -> project_root
            let project_root = exe_path
                .parent().ok_or("No parent 1")?  // debug folder
                .parent().ok_or("No parent 2")?  // target folder
                .parent().ok_or("No parent 3")?  // src-tauri folder
                .parent().ok_or("No parent 4")?; // project root
            
            let path = project_root.join("node-backend");
            eprintln!("Looking for node-backend at: {:?}", path);
            
            if !path.exists() {
                return Err(format!("Sidecar directory not found at: {:?}", path));
            }
            
            Ok(path)
        } else {
            let path = exe_path.parent().unwrap().join("node-backend");
            Ok(path)
        }
    }

    pub async fn call(&self, app_handle: AppHandle, method: &str, params: Value) -> Result<Value, String> {
        self.start(app_handle).await?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let request = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params
        });

        let mut process_guard = self.process.lock().await;
        let child = process_guard.as_mut().ok_or("Sidecar not running")?;
        let stdin = child.stdin.as_mut().ok_or("Sidecar stdin not available")?;

        let mut rx = self.line_tx.subscribe();

        let request_str = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        stdin.write_all(format!("{}\n", request_str).as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;

        // Wait for response from broadcast channel
        loop {
            let line = tokio::time::timeout(tokio::time::Duration::from_secs(60), rx.recv())
                .await
                .map_err(|_| "Timeout waiting for response".to_string())?
                .map_err(|e| e.to_string())?;

            if let Ok(response) = serde_json::from_str::<Value>(&line) {
                if response.get("id").and_then(|i| i.as_str()) == Some(&request_id) {
                    if let Some(error) = response.get("error") {
                        return Err(format!("RPC error: {}", error));
                    }
                    return response.get("result").cloned().ok_or("No result".to_string());
                }
            }
        }
    }

    pub async fn stop(&self) {
        let mut process_guard = self.process.lock().await;
        if let Some(mut child) = process_guard.take() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.shutdown().await;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            let _ = child.kill().await;
        }
    }
}
