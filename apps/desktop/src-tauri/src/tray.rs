//! 托盘（ADR-0005/0009）：仅服务生命周期入口 —— 打开 SAG / 退出 SAG。
//! 不承载宠物或任何业务形态。

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::window;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "打开 SAG").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 SAG").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("SAG")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => window::focus_any_window(app),
            "quit" => crate::request_quit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
        // macOS 菜单栏用模板（单色）渲染
        #[cfg(target_os = "macos")]
        {
            tray = tray.icon_as_template(true);
        }
    }
    tray.build(app)?;
    Ok(())
}
