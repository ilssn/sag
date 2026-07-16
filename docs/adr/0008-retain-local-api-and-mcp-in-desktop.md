---
status: accepted
---

# 桌面版保留仅限本机的 API 与 MCP 集成

桌面 V1 不把 FastAPI sidecar 降级为仅供内嵌界面使用的内部服务，而是继续向同一台电脑上的 Claude、Cursor、Codex 等外部宿主提供知识库 API 与 MCP。桌面端点只监听本机回环地址；局域网和公网访问仍属于自托管服务的边界。这样保留“知识库可被外部 Agent 使用”的核心产品亮点，同时避免桌面安装默认扩大网络攻击面。
