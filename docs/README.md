# muse 文档

> **muse** —— 新一代 **Agentic Data Manager · Context Infrastructure**。
> 以 `zleap-sag` 为数据基座，把「上下文」做成一等公民：**个人的信息助手，企业的决策大脑，Agent 的灵魂。**

这套文档把产品愿景拆成**可原型、可实施**的蓝图。建议阅读顺序：

## 一、产品（先读）
- [产品愿景与定位](product/vision.md) —— 我们在做什么、为谁、为什么能超越 RAGFlow；命名体系。
- [核心概念模型](product/concepts.md) —— **最重要**。上下文 / 信源 / 命名空间 / 灵魂 / 人格 / 连接器 / 记忆，及其关系与代码映射。
- [使用场景](product/use-cases.md) —— 个人 / 企业 / Agent 灵魂；上传一本书变人物；本地 Agent「夺舍」。

## 二、架构（做原型时读）
- [架构总览](architecture/overview.md) —— 分层演进：在现有 SAG 适配 / 连接器 / 任务 / 生成层上如何长出新能力。
- [数据模型](architecture/data-model.md) —— 演进后的表结构（现有 + 新增），可直接建模。
- [连接器框架](architecture/connectors.md) —— 静态 / 动态 / 流式；文档·消息·会话·录音；统一接入协议与持续写入。
- [灵魂与记忆](architecture/souls-and-memory.md) —— 灵魂 / 人格 / 命名空间 / 会话记忆 / 对话流。
- [插件与挂载](architecture/plugins-and-mounts.md) —— 本地 Agent 挂载与「夺舍」、MCP/Skill/Hook 上下文插件、书→人物。
- [企业级](architecture/enterprise.md) —— 审计、日志、RBAC、配置、可观测、部署。

## 三、设计与路线
- [设计系统与信息架构](design/design-and-ia.md) —— 审美升级、导航、关键界面规格、动效语言。
- [路线图](../docs/roadmap.md) —— 从地基到愿景的分阶段实施。

## 现状参考
- [as-built 架构](architecture.md) —— 当前**已实现**代码的准确说明（P0–P4a）。上面的 `architecture/` 是**目标设计**。

---

设计原则贯穿全篇：**从基础出发，再拓展** · **上下文优先** · **标准接入、可拓展** · **企业级严谨（审计/日志/配置清晰）** · **克制而升级的审美** · **生产力而非 demo**。
