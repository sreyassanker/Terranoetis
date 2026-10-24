mod backend_manager;
mod youtube_server;

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

#[tauri::command]
fn get_embed_port() -> u16 {
    youtube_server::get_embed_port()
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &url]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = url;
        Err("Unsupported platform".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_manager = BackendManager::new();

    let app = tauri::Builder::default()
        .manage(backend_manager)
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            start_backend,
            stop_backend,
            get_embed_port,
            open_external_url
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Start native loopback YouTube embed server on 127.0.0.1
            let embed_port = youtube_server::start_embed_server();
            log::info!("[Terranoetis] YouTube embed bridge initialized on port {}", embed_port);

            // Configure default application menu (provides standard macOS App, Edit, View with Cmd+R Reload, Window menus)
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;

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
