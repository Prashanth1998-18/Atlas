// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod sidecar;
mod state;

use tauri::Manager;

fn main() {
    // Load API keys from saved settings into environment
    commands::settings::init_settings_env();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize sidecar manager
            let sidecar_manager = sidecar::manager::SidecarManager::new();
            app.manage(sidecar_manager);
            
            // Initialize preview request state
            let preview_request = commands::document::PreviewRequest::new();
            app.manage(preview_request);
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::open_workspace,
            commands::workspace::close_workspace,
            commands::workspace::get_workspace_status,
            commands::workspace::list_workspace_documents,
            commands::workspace::list_workspace_directory,
            commands::workspace::read_workspace_file_bytes,
            commands::search::search,
            commands::chat::chat,
            commands::conversation::create_conversation,
            commands::conversation::list_conversations,
            commands::conversation::get_conversation,
            commands::conversation::update_conversation_title,
            commands::conversation::delete_conversation,
            commands::conversation::add_message,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::document::set_preview_path,
            commands::document::get_preview_content,
            commands::document::get_active_document_draft,
            commands::document::discard_document_draft,
            commands::document::save_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
