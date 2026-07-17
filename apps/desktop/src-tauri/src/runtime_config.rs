//! 运行时配置注入（ADR-0007）：以 initialization_script 在任何页面脚本之前
//! 写入 `window.__SAG_RUNTIME_CONFIG__`，导航与刷新后依然先于页面执行。
//! 本地访问密钥（ADR-0011）是外部宿主凭据，绝不进入 WebView。

use serde_json::json;

pub fn build_init_script(port: u16) -> String {
    let config = json!({
        "apiBase": format!("http://127.0.0.1:{port}"),
        "host": "desktop",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "flags": { "enableWindowScaling": false },
    });
    format!("window.__SAG_RUNTIME_CONFIG__ = {config};")
}

#[cfg(test)]
mod tests {
    #[test]
    fn script_contains_contract_fields() {
        let script = super::build_init_script(47240);
        assert!(script.starts_with("window.__SAG_RUNTIME_CONFIG__ = "));
        assert!(script.contains("http://127.0.0.1:47240"));
        assert!(script.contains("\"enableWindowScaling\":false"));
        assert!(script.contains("\"host\":\"desktop\""));
    }
}
