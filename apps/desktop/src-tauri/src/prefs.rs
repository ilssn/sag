//! 壳侧偏好（shell-settings.json）。
//!
//! 存壳侧而非 API 数据库：`close_to_quit` 与 `port` 在 sidecar 尚未存在 /
//! 已崩溃时也必须可读，放 API 里会形成自举环（ADR-0009/0010）。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "shell-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ShellPrefs {
    /// 本地服务端口；None = 默认 47240（ADR-0022）。
    pub port: Option<u16>,
    /// true = 关窗即退出；默认关窗仅隐藏、服务常驻（ADR-0009）。
    pub close_to_quit: bool,
    /// "prompt"（默认，提示式更新）| "manual"（仅手动检查）。
    pub update_policy: String,
}

impl Default for ShellPrefs {
    fn default() -> Self {
        Self {
            port: None,
            close_to_quit: false,
            update_policy: "prompt".to_string(),
        }
    }
}

pub fn load(config_dir: &PathBuf) -> ShellPrefs {
    let path = config_dir.join(FILE_NAME);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|error| {
            tracing::warn!(%error, ?path, "shell-settings.json 解析失败，使用默认偏好");
            ShellPrefs::default()
        }),
        Err(_) => ShellPrefs::default(),
    }
}

pub fn save(config_dir: &PathBuf, prefs: &ShellPrefs) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let path = config_dir.join(FILE_NAME);
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}
