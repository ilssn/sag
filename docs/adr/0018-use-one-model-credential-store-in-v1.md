---
status: accepted
---

# V1 的 Web 与桌面沿用同一套模型凭据存储

V1 不引入 macOS Keychain、Windows Credential Manager 或桌面专用 `SecretStore`，LLM、Embedding 和解析服务 API Key 在 Web 与桌面中继续由现有后端设置记录统一持久化。桌面数据目录限制为当前系统用户可访问，API 只返回密钥是否已配置，日志、错误与诊断信息必须脱敏；完整数据备份会包含凭据并在导出时明确提示。该取舍优先保持一套后端行为和较低实现复杂度，未来出现多用户、云同步或合规要求时再引入加密凭据存储。
