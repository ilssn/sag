//! 自托管更新（ADR-0020）：提示式安装 —— 就绪后 10 秒 + 每 24 小时 +
//! 设置页手动检查；不做退出时静默安装（与常驻语义冲突）。

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
const PERIODIC_CHECK: Duration = Duration::from_secs(24 * 60 * 60);

/// setup 时挂起的后台检查循环（update_policy=manual 时仅跳过自动检查）。
pub fn spawn_background_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let policy = app
                .path()
                .app_config_dir()
                .map(|dir| crate::prefs::load(&dir).update_policy)
                .unwrap_or_else(|_| "prompt".to_string());
            if policy != "manual" {
                if let Err(error) = check_and_prompt(&app).await {
                    tracing::warn!(%error, "更新检查失败");
                }
            }
            tokio::time::sleep(PERIODIC_CHECK).await;
        }
    });
}

/// 设置页手动检查：返回结果文案。
pub async fn check_now(app: AppHandle) -> Result<String, String> {
    match fetch_update(&app).await? {
        Some(version) => {
            prompt_install(&app, &version);
            Ok(format!("发现新版本 {version}"))
        }
        None => Ok("当前已是最新版本".to_string()),
    }
}

async fn check_and_prompt(app: &AppHandle) -> Result<(), String> {
    if let Some(version) = fetch_update(app).await? {
        prompt_install(app, &version);
    }
    Ok(())
}

async fn fetch_update(app: &AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version.clone()))
}

fn prompt_install(app: &AppHandle, version: &str) {
    let app_handle = app.clone();
    let version = version.to_string();
    app.dialog()
        .message(format!("SAG {version} 可用。现在更新吗？"))
        .title("发现新版本")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "立即更新".to_string(),
            "稍后".to_string(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            tauri::async_runtime::spawn(async move {
                match download_and_install(&app_handle).await {
                    Ok(()) => {
                        tracing::info!("更新已安装，重启应用");
                        // 先优雅停掉 sidecar 再重启壳
                        crate::graceful_stop_sidecar(&app_handle).await;
                        app_handle.restart();
                    }
                    Err(error) => tracing::error!(%error, "更新安装失败"),
                }
            });
        });
}

async fn download_and_install(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    update
        .download_and_install(
            |_chunk, _total| {},
            || tracing::info!("更新下载完成"),
        )
        .await
        .map_err(|e| e.to_string())
}
