mod backend_manager;

use backend_manager::{BackendManager, BackendStatus};
use tauri::{Manager, State};

#[tauri::command]
fn get_backend_status(backend: State<'_, BackendManager>) -> BackendStatus {
    backend.status()
}

#[tauri::command]
fn start_backend(backend: State<'_, BackendManager>) -> BackendStatus {
    backend.start()
}

#[tauri::command]
fn stop_backend(backend: State<'_, BackendManager>) -> BackendStatus {
    backend.stop()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_manager = BackendManager::new();

    let app = tauri::Builder::default()
        .manage(backend_manager)
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            start_backend,
            stop_backend
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Automatically start the backend server in the background on startup
            if let Some(backend) = app.try_state::<BackendManager>() {
                log::info!("[Terranoetis] Auto-starting background backend service...");
                backend.start();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event {
                log::info!("[Terranoetis] Window closing. Stopping backend server...");
                if let Some(backend) = window.app_handle().try_state::<BackendManager>() {
                    backend.stop();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Automatically stop the backend server when the desktop app is closed or exits
    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            log::info!("[Terranoetis] Application exiting. Stopping backend server...");
            if let Some(backend) = app_handle.try_state::<BackendManager>() {
                backend.stop();
            }
        }
        _ => {}
    });
}
