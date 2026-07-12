# OCTX Machine Schemas

OCTX v0.1 使用 JSON Schema Draft 2020-12 校验单条 JSON 结构：

- [manifest](0.1/manifest.schema.json)
- [chunk](0.1/chunk.schema.json)
- [event](0.1/event.schema.json)
- [entity](0.1/entity.schema.json)
- [chunk-event relation](0.1/chunk-event.schema.json)
- [event-entity relation](0.1/event-entity.schema.json)
- [vector configuration](0.1/vector-config.schema.json)

JSONL 文件逐行使用对应 record schema。所有 schema 允许未知可选字段，以满足向前兼容和 round-trip 要求。

JSON Schema 只负责单个 JSON object 的结构约束。以下内容必须由 OCTX 语义校验器完成：

- ZIP 路径、条目类型和资源上限。
- 文件清单完整性和路径唯一性。
- 至少一篇 OKF Concept Document。
- UUID 在 Package 中的唯一性。
- JSONL 跨记录引用和关系组合唯一性。
- Event 层级、循环和 level。
- SAG-structured 完整覆盖。
- Arrow schema 与向量覆盖。
- Arrow IPC 消息边界、批次数量、行数、向量值总量，以及 vectors 0.1 禁止 body compression 的约束。
- 逐文件 SHA-256 和 Package Digest。

规范来源：

- [OCTX v0.1](../spec-v0.1.md)
- [SAG-structured Profile 0.1](../sag-structured-v0.1.md)
