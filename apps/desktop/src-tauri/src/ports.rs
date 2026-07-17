//! 端口选择（ADR-0010/0022）：固定公开默认端口，冲突显式修复，绝不静默漂移。

use std::net::TcpListener;

/// 桌面默认端口（ADR-0022）；与 `sag_api/sidecar.py::DEFAULT_DESKTOP_PORT` 同步维护。
pub const DEFAULT_PORT: u16 = 47240;

/// 用户可配置范围（boot 页输入校验同款）。
pub const PORT_MIN: u16 = 1024;
pub const PORT_MAX: u16 = 49151;

/// 预探测端口可绑定性。TOCTOU 由 sidecar 自身的 port-conflict 终态事件兜底。
pub fn probe(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

pub fn is_valid(port: u16) -> bool {
    (PORT_MIN..=PORT_MAX).contains(&port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_detects_taken_port() {
        let blocker = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = blocker.local_addr().expect("addr").port();
        assert!(!probe(port));
        drop(blocker);
        assert!(probe(port));
    }

    #[test]
    fn valid_range() {
        assert!(is_valid(DEFAULT_PORT));
        assert!(!is_valid(80));
        assert!(!is_valid(49500));
    }
}
