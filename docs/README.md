# sag 文档

> **sag** —— 一个干净、清晰、好用的 **SAG 开源示范项目**（单用户）。
> 以 `zleap-sag` 为引擎：创建信源 → 上传文档 → 搜索/溯源 → Agent 绑定信源、带引用对话。**信源即 MCP。**

## 工程规范（最佳实践正典）

- [**standards/**](standards/README.md) —— 价值理念与门禁 · [架构规范](standards/architecture.md) · [前端规范](standards/frontend.md) · [产品设计规范](standards/product.md)。**代码与规范不一致视为 bug。**

## 当前文档（as-built）

- [**架构（as-built）**](architecture.md) —— 当前已实现的系统：分层、数据模型、Agent Runtime、信源 MCP。**先读这篇。**
- [**知识宇宙**](architecture/knowledge-universe.md) —— 3D 探索视图：计数轴时间飞行、虚拟时间窗、快照分页与场景预算。
- [**Agent · MCP · 搜索图谱**](architecture/agent-mcp-graph.md) —— 当前三条能力链路的边界、契约与实现位置。
- [**Agent Runtime**](architecture/agent-runtime.md) —— extract-ready 的 `sag_agent` Core：公共 API、生命周期、事件契约、工具审批与宿主适配。
- [连接器框架](architecture/connectors.md) —— 采集抽象：file_upload / web，统一接入协议。
- 顶层 [README](../README.md) —— 快速开始、三步主干、MCP 用法、OpenAI 兼容端点。

## 目标设计与实施计划

- [**下一代 4D 知识探索工作台**](superpowers/plans/2026-07-15-next-generation-knowledge-atlas.md)
  —— 统一范围、渐进式 4D 呈现、探索—阅读—问答闭环、v3 数据契约、性能门禁与一次切换计划。
