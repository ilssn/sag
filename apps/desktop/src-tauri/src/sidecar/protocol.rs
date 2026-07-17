//! sidecar JSONL 启动协议（ADR-0017）。
//!
//! 解析保持宽容：未知事件/字段忽略；`ready` 校验 nonce + protocol + app_version。

use serde::Deserialize;

/// 壳支持的协议版本；`ready.protocol` 不一致视为终态错误。
pub const PROTOCOL_VERSION: u64 = 1;

/// 后端事件（stdout 每行一条 JSON）。字段全部可缺省以宽容前向演进。
#[derive(Debug, Clone, Deserialize)]
pub struct SidecarEvent {
    #[serde(default)]
    pub v: Option<u64>,
    pub event: String,
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub app_version: Option<String>,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub protocol: Option<u64>,
    #[serde(default)]
    pub current: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub recoverable: Option<bool>,
    #[serde(default)]
    pub capabilities: Option<Vec<String>>,
}

/// 终态错误码：出现即停止自动重启（ADR-0017）。
pub const TERMINAL_ERROR_CODES: &[&str] = &[
    "port-conflict",
    "instance-already-running",
    "migration-failed",
    "engine-data-incompatible",
];

pub fn is_terminal_code(code: &str) -> bool {
    TERMINAL_ERROR_CODES.contains(&code)
}

pub fn parse_line(line: &str) -> Option<SidecarEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    match serde_json::from_str::<SidecarEvent>(trimmed) {
        Ok(event) => Some(event),
        Err(error) => {
            tracing::warn!(%error, line = trimmed, "无法解析的 sidecar 事件行（忽略）");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ready_event() {
        let event = parse_line(
            r#"{"v":1,"event":"ready","nonce":"n","app_version":"1.2.2","api_version":"v1","protocol":1,"capabilities":["http-api"]}"#,
        )
        .expect("parse");
        assert_eq!(event.event, "ready");
        assert_eq!(event.nonce.as_deref(), Some("n"));
        assert_eq!(event.protocol, Some(1));
        assert_eq!(event.capabilities.as_deref(), Some(&["http-api".to_string()][..]));
    }

    #[test]
    fn tolerates_unknown_fields_and_garbage() {
        assert!(parse_line(r#"{"v":1,"event":"start","future_field":42}"#).is_some());
        assert!(parse_line("not-json").is_none());
        assert!(parse_line("").is_none());
    }

    #[test]
    fn terminal_codes_match_adr_0017() {
        for code in ["port-conflict", "instance-already-running", "migration-failed", "engine-data-incompatible"] {
            assert!(is_terminal_code(code));
        }
        assert!(!is_terminal_code("startup-failed"));
    }
}
