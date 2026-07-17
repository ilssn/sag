//! 窗口编排：boot（启动/恢复页）与 main（工作台）。
//!
//! 运行时配置必须在窗口创建时以 initialization_script 注入（ADR-0007），
//! 端口变化（用户改端口重试）需要重建窗口 —— 因此 boot 与 main 分离：
//! boot 不带配置脚本，main 在 sidecar 就绪、端口定格后才创建。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::runtime_config;

pub const BOOT_LABEL: &str = "boot";
pub const MAIN_LABEL: &str = "main";

pub fn create_boot_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(BOOT_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, BOOT_LABEL, WebviewUrl::App("boot.html".into()))
        .title("SAG")
        .inner_size(460.0, 400.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .build()?;
    Ok(())
}

/// sidecar 就绪后调用：创建工作台窗口（带运行时配置注入）并收起 boot 窗口。
pub fn show_main_window(app: &AppHandle, port: u16) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(MAIN_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
    } else {
        WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
            .title("SAG")
            .inner_size(1280.0, 800.0)
            .min_inner_size(960.0, 640.0)
            .initialization_script(&runtime_config::build_init_script(port))
            .build()?;
    }
    if let Some(boot) = app.get_webview_window(BOOT_LABEL) {
        let _ = boot.close();
    }
    Ok(())
}

/// 终态错误 / 崩溃循环时回到 boot 恢复页。
pub fn show_boot_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.close();
    }
    if let Err(error) = create_boot_window(app) {
        tracing::error!(%error, "创建启动窗口失败");
        return;
    }
    if let Some(boot) = app.get_webview_window(BOOT_LABEL) {
        let _ = boot.show();
        let _ = boot.set_focus();
    }
}

/// 显示并聚焦任一现存窗口（托盘「打开」与二次启动聚焦共用）。
pub fn focus_any_window(app: &AppHandle) {
    for label in [MAIN_LABEL, BOOT_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            return;
        }
    }
    // 两个窗口都不在（main 曾被隐藏后关闭等边界）：回到 boot 页兜底
    show_boot_window(app);
}
