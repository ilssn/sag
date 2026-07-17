//! invoke 命令面：boot 页与设置页的全部特权操作走这里（capability 只授 core:default）。

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::prefs::{self, ShellPrefs};
use crate::sidecar::supervisor::{BootPayload, Supervisor};
use crate::{ports, updater};

#[tauri::command]
pub fn boot_status(supervisor: State<'_, Arc<Supervisor>>) -> BootPayload {
    supervisor.current_status()
}

#[tauri::command]
pub fn retry_startup(supervisor: State<'_, Arc<Supervisor>>) {
    supervisor.inner().clone().retry();
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::request_quit(&app);
}

#[tauri::command]
pub fn open_logs(app: AppHandle) -> Result<(), String> {
    let dir = crate::logging::log_dir(&app);
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_shell_prefs(app: AppHandle) -> Result<ShellPrefs, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(prefs::load(&config_dir))
}

#[tauri::command]
pub fn set_shell_prefs(app: AppHandle, next: ShellPrefs) -> Result<(), String> {
    if let Some(port) = next.port {
        if !ports::is_valid(port) {
            return Err(format!(
                "端口必须在 {}-{} 范围内",
                ports::PORT_MIN,
                ports::PORT_MAX
            ));
        }
    }
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    prefs::save(&config_dir, &next)
}

#[tauri::command]
pub fn set_port_preference(app: AppHandle, port: u16) -> Result<(), String> {
    if !ports::is_valid(port) {
        return Err(format!(
            "端口必须在 {}-{} 范围内",
            ports::PORT_MIN,
            ports::PORT_MAX
        ));
    }
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let mut current = prefs::load(&config_dir);
    current.port = Some(port);
    prefs::save(&config_dir, &current)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    updater::check_now(app).await
}
