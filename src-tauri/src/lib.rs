// A Rust toolchain is required to compile and package the actual Tauri desktop build.
use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const SHOW_WINDOW_MENU_ID: &str = "show_window";
const QUIT_MENU_ID: &str = "quit";
const SERVER_SCRIPT_RELATIVE_PATH: &str = "packages/server/dist/index.js";

pub struct NodeSidecar {
    child: Mutex<Option<Child>>,
}

impl NodeSidecar {
    pub fn spawn(server_path: &Path) -> std::io::Result<Self> {
        let child = Command::new("node")
            .arg(server_path)
            .spawn()?;
        Ok(NodeSidecar {
            child: Mutex::new(Some(child)),
        })
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

impl Drop for NodeSidecar {
    fn drop(&mut self) {
        self.kill();
    }
}

#[tauri::command]
fn get_server_url() -> String {
    "http://localhost:3210".to_string()
}

#[tauri::command]
fn get_ws_url() -> String {
    "ws://localhost:3210".to_string()
}

#[tauri::command]
fn is_tauri_env() -> bool {
    true
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_ws_url,
            is_tauri_env,
        ])
        .setup(|app| {
            let show_window = MenuItem::with_id(
                app,
                SHOW_WINDOW_MENU_ID,
                "显示窗口",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_window, &quit])?;
            let tray = app
                .tray_by_id(TRAY_ID)
                .ok_or_else(|| std::io::Error::other("configured system tray was not created"))?;
            tray.set_menu(Some(tray_menu))?;

            #[cfg(not(debug_assertions))]
            {
                // The production bundle copies this relative path into Tauri's resource directory.
                let server_path = app
                    .path()
                    .resource_dir()?
                    .join(SERVER_SCRIPT_RELATIVE_PATH);
                app.manage(NodeSidecar::spawn(&server_path)?);
            }

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_WINDOW_MENU_ID => show_main_window(app),
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                id,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if id.as_ref() == TRAY_ID {
                    show_main_window(app);
                }
            }
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. }
                    if !cfg!(debug_assertions) && window.label() == MAIN_WINDOW_LABEL =>
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    if let Some(sidecar) = window.app_handle().try_state::<NodeSidecar>() {
                        sidecar.kill();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AgentLink");
}
