use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

pub struct NodeSidecar {
    child: Mutex<Option<Child>>,
}

impl NodeSidecar {
    pub fn spawn(server_path: &str) -> Option<Self> {
        let child = Command::new("node")
            .arg(server_path)
            .spawn()
            .ok();
        child.map(|c| NodeSidecar {
            child: Mutex::new(Some(c)),
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

pub fn run() {
    let server_script = if cfg!(debug_assertions) {
        // In dev mode, user starts server separately via pnpm dev
        None
    } else {
        // In production, spawn the compiled Node.js server
        Some("packages/server/dist/index.js")
    };

    let sidecar = server_script.and_then(|path| NodeSidecar::spawn(path));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_ws_url,
            is_tauri_env,
        ])
        .setup(|app| {
            if let Some(sc) = sidecar {
                app.manage(sc);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(sidecar) = app.try_state::<NodeSidecar>() {
                    sidecar.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AgentLink");
}
