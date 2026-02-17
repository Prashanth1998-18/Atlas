use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub api_key: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

fn get_settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let atlas_dir = home.join(".atlas");
    fs::create_dir_all(&atlas_dir).ok();
    atlas_dir.join("settings.json")
}

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    let path = get_settings_path();
    
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    
    let settings: AppSettings = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;
    
    // Return settings with masked API key for display
    Ok(AppSettings {
        api_key: settings.api_key.map(|k| {
            if k.len() > 8 {
                format!("{}...{}", &k[..4], &k[k.len()-4..])
            } else {
                "****".to_string()
            }
        }),
        provider: settings.provider,
        model: settings.model,
    })
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    
    // If API key looks masked, load the existing one
    let final_settings = if settings.api_key.as_ref().map(|k| k.contains("...") || k.contains("•")).unwrap_or(false) {
        // Load existing settings to preserve API key
        let existing = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str::<AppSettings>(&content).unwrap_or_default()
        } else {
            AppSettings::default()
        };
        
        AppSettings {
            api_key: existing.api_key,
            provider: settings.provider.or(existing.provider),
            model: settings.model.or(existing.model),
        }
    } else {
        settings
    };
    
    let content = serde_json::to_string_pretty(&final_settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    
    // Also set environment variables for the current session
    if let Some(ref key) = final_settings.api_key {
        match final_settings.provider.as_deref() {
            Some("anthropic") => std::env::set_var("ANTHROPIC_API_KEY", key),
            _ => std::env::set_var("OPENAI_API_KEY", key),
        }
    }
    
    Ok(())
}

/// Load settings and set environment variables at startup
pub fn init_settings_env() {
    let path = get_settings_path();
    
    if !path.exists() {
        return;
    }
    
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
            if let Some(ref key) = settings.api_key {
                match settings.provider.as_deref() {
                    Some("anthropic") => std::env::set_var("ANTHROPIC_API_KEY", key),
                    _ => std::env::set_var("OPENAI_API_KEY", key),
                }
                eprintln!("Loaded API key from settings");
            }
        }
    }
}


