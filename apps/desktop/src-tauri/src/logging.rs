//! 壳日志（tracing → app_log_dir/shell.log）与 sidecar stderr 落盘（sidecar.log）。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::ChildStderr;

pub fn init(app: &AppHandle) {
    let log_dir = log_dir(app);
    let _ = std::fs::create_dir_all(&log_dir);
    let appender = tracing_appender::rolling::daily(&log_dir, "shell.log");
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(appender)
        .with_ansi(false);
    if subscriber.try_init().is_err() {
        // dev 下重复初始化（HMR/重启）忽略
    }
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "SAG 桌面壳启动");
}

pub fn log_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("sag-logs"))
}

/// sidecar stderr（人类日志通道）逐行落盘 sidecar.log；stdout 专属 JSONL 协议。
pub fn pipe_sidecar_stderr(app: &AppHandle, stderr: ChildStderr) {
    let path = log_dir(app).join("sidecar.log");
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut file = OpenOptions::new().create(true).append(true).open(&path).ok();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(handle) = file.as_mut() {
                let _ = writeln!(handle, "{line}");
            }
        }
    });
}
