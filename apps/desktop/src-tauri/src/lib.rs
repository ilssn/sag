//! SAG 桌面壳（Tauri v2）。
//!
//! 职责：拉起并监督 FastAPI sidecar（ADR-0017）、按 ADR-0007 注入运行时配置、
//! 关窗即隐藏的常驻生命周期与托盘（ADR-0005/0009）、单实例聚焦（ADR-0016）、
//! 自托管更新（ADR-0020）。业务 UI 完全复用 apps/web 静态导出（ADR-0006）。

mod commands;
mod logging;
mod ports;
mod prefs;
mod runtime_config;
mod sidecar;
mod tray;
mod updater;
mod window;

use std::sync::Arc;

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

use sidecar::supervisor::Supervisor;

/// 显式退出（托盘 Quit / Cmd+Q / boot 页退出）：优雅停 sidecar 后退出进程。
pub(crate) fn request_quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        graceful_stop_sidecar(&app).await;
        app.exit(0);
    });
}

pub(crate) async fn graceful_stop_sidecar(app: &AppHandle) {
    if let Some(supervisor) = app.try_state::<Arc<Supervisor>>() {
        supervisor.quit().await;
    }
}

pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：二次启动仅聚焦主实例窗口（ADR-0016）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_any_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::boot_status,
            commands::retry_startup,
            commands::quit_app,
            commands::open_logs,
            commands::get_shell_prefs,
            commands::set_shell_prefs,
            commands::set_port_preference,
            commands::check_for_updates,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            logging::init(&handle);
            tray::create_tray(&handle)?;

            // 启动窗口先行：感知启动瞬时完成，引擎预热在后台推进
            window::create_boot_window(&handle)?;

            let supervisor = Arc::new(Supervisor::new(handle.clone()));
            app.manage(supervisor.clone());
            tauri::async_runtime::spawn(async move {
                supervisor.start().await;
            });

            updater::spawn_background_checks(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗默认隐藏、服务常驻；用户偏好 close_to_quit 时走完整退出（ADR-0009）
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != window::MAIN_LABEL {
                    return; // boot 窗口关闭 = 正常关闭（终态错误下等价放弃启动）
                }
                let app = window.app_handle();
                let close_to_quit = app
                    .path()
                    .app_config_dir()
                    .map(|dir| prefs::load(&dir).close_to_quit)
                    .unwrap_or(false);
                let quitting = app
                    .try_state::<Arc<Supervisor>>()
                    .map(|s| s.is_quitting())
                    .unwrap_or(false);
                if close_to_quit || quitting {
                    return; // 放行关闭；退出流程由 request_quit/ExitRequested 收尾
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("初始化 Tauri 应用失败")
        .run(|app, event| match event {
            // Cmd+Q / OS 注销等触发：先停 sidecar 再放行退出
            RunEvent::ExitRequested { api, code, .. } => {
                let already_quitting = app
                    .try_state::<Arc<Supervisor>>()
                    .map(|s| s.is_quitting())
                    .unwrap_or(true);
                if code.is_none() && !already_quitting {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
            // macOS Dock 点击重新打开
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                window::focus_any_window(app);
            }
            _ => {}
        });
}
