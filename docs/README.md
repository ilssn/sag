# sag 文档

> **sag** —— 一个干净、清晰、好用的 **SAG 开源示范项目**（单用户）。
> 以 `zleap-sag` 为引擎：创建信源 → 上传文档 → 搜索/溯源 → Agent 绑定信源、带引用对话。**信源即 MCP。**

## 当前文档（as-built）

- [**架构（as-built）**](architecture.md) —— 当前已实现的系统：分层、数据模型、Agent 工具循环、信源 MCP。**先读这篇。**
- [**Agent · MCP · 图谱**](architecture/agent-mcp-graph.md) —— 从旧版 SAG 承接的三条策略及其落地：Agent 解耦（工具层，已实现）、MCP（已实现）、图谱展示（待做）。
- [连接器框架](architecture/connectors.md) —— 采集抽象：file_upload / web，统一接入协议。
- 顶层 [README](../README.md) —— 快速开始、三步主干、MCP 用法、OpenAI 兼容端点。

## 历史存档（早期企业形态设计）

> 以下文档来自 sag 早期的「团队 / 多租户 / 灵魂 + 记忆」产品设想。项目现已收敛为**单用户 SAG 示范**，不含多租户、团队权限、审计、soul + 记忆闭环、mem0。保留作设计史参考，**不代表当前实现**。

- 产品：[愿景](product/vision.md) · [概念模型](product/concepts.md) · [使用场景](product/use-cases.md) · [产品形态](product/product-form.md) · [MVP 蓝图](product/mvp-blueprint.md)
- 竞品调研：[RAGFlow 深潜](product/ragflow-deep-dive.md) · [收敛记录](product/research-convergence.md) · [差距分析](product/gap-analysis.md)
- 架构（目标态）：[总览](architecture/overview.md) · [数据模型](architecture/data-model.md)
- 设计：[设计系统与 IA](design/design-and-ia.md)
- [路线图](roadmap.md)

> 已退休的设计文档（多租户 / soul+记忆 / 旧挂载模型 / mem0）以短桩标注，指回当前文档。
