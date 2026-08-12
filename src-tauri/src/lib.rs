// A Rust toolchain is required to compile and package the actual Tauri desktop build.
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const SHOW_WINDOW_MENU_ID: &str = "show_window";
const QUIT_MENU_ID: &str = "quit";
#[cfg(not(debug_assertions))]
const SERVER_SCRIPT_RELATIVE_PATH: &str = "packages/server/dist/index.js";

pub struct NodeSidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
}

pub struct TracingState {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}

impl NodeSidecar {
    pub fn spawn(
        app: &tauri::AppHandle,
        server_path: &Path,
        server_log_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let (mut events, child) = app
            .shell()
            .sidecar("chorus-node")?
            .env("NODE_ENV", "production")
            .env("SERVER_LOG_FILE", server_log_path)
            .env("CHORUS_PARENT_PID", std::process::id().to_string())
            .arg(server_path)
            .spawn()?;
        tracing::info!(pid = child.pid(), path = %server_path.display(), "server sidecar spawned");
        let shared_child = Arc::new(Mutex::new(Some(child)));
        let monitor_child = Arc::clone(&shared_child);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        tracing::debug!(output = %String::from_utf8_lossy(&line), "server sidecar stdout");
                    }
                    CommandEvent::Stderr(line) => {
                        tracing::warn!(output = %String::from_utf8_lossy(&line), "server sidecar stderr");
                    }
                    CommandEvent::Error(error) => {
                        tracing::error!(%error, "server sidecar process error");
                    }
                    CommandEvent::Terminated(payload) => {
                        tracing::info!(code = ?payload.code, signal = ?payload.signal, "server sidecar exited");
                        if let Ok(mut guard) = monitor_child.lock() {
                            *guard = None;
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(NodeSidecar {
            child: shared_child,
        })
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                tracing::info!(pid = child.pid(), "stopping server sidecar");
                if let Err(error) = child.kill() {
                    tracing::error!(%error, "failed to stop server sidecar");
                }
            }
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
        tracing::info!(window = MAIN_WINDOW_LABEL, "showing application window");
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_ws_url,
            is_tauri_env,
        ])
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            let file_appender = tracing_appender::rolling::never(&log_dir, "chorus.log");
            let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
            let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
            let _ = tracing_subscriber::fmt()
                .with_env_filter(env_filter)
                .with_ansi(false)
                .with_writer(non_blocking)
                .try_init();
            app.manage(TracingState { _guard: guard });
            tracing::info!("Chorus application started");

            let show_window =
                MenuItem::with_id(app, SHOW_WINDOW_MENU_ID, "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_window, &quit])?;
            let tray = app
                .tray_by_id(TRAY_ID)
                .ok_or_else(|| std::io::Error::other("configured system tray was not created"))?;
            tray.set_menu(Some(tray_menu))?;

            #[cfg(not(debug_assertions))]
            {
                // The production bundle copies this relative path into Tauri's resource directory.
                let server_path = app.path().resource_dir()?.join(SERVER_SCRIPT_RELATIVE_PATH);
                let server_log_path = log_dir.join("server.log");
                app.manage(NodeSidecar::spawn(
                    app.handle(),
                    &server_path,
                    &server_log_path,
                )?);
            }

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_WINDOW_MENU_ID => {
                tracing::info!("show-window tray menu clicked");
                show_main_window(app)
            }
            QUIT_MENU_ID => {
                tracing::info!("quit tray menu clicked");
                app.exit(0)
            }
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
                    tracing::info!("tray icon clicked");
                    show_main_window(app);
                }
            }
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. }
                if !cfg!(debug_assertions) && window.label() == MAIN_WINDOW_LABEL =>
            {
                api.prevent_close();
                tracing::info!(window = window.label(), "hiding application window");
                let _ = window.hide();
            }
            tauri::WindowEvent::Destroyed => {
                tracing::info!(window = window.label(), "application window destroyed");
                if let Some(sidecar) = window.app_handle().try_state::<NodeSidecar>() {
                    sidecar.kill();
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Chorus")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(sidecar) = app.try_state::<NodeSidecar>() {
                    sidecar.kill();
                }
            }
        });
}
