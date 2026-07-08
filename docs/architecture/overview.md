# 架构总览（目标设计）

> 现有代码（P0–P4a）见 [as-built](../architecture.md)。本篇描述**演进方向**——如何在现有分层上长出愿景能力，且**纯增量、不迁移、不改引擎**。

## 分层（演进后）

```
┌──────────────────────────────────────────────────────────────────┐
│ apps/web   Next.js · 灵魂工作台 / 上下文库 / 连接器 / 洞察 / 设置    │
├──────────────────────────────────────────────────────────────────┤
│ api/v1     HTTP：souls · namespaces · sources · ingest · connectors │
│            · mounts · books · insights · audit · system            │
├──────────────────────────────────────────────────────────────────┤
│ services   领域逻辑（纯）：soul / namespace / source / memory /     │
│            connector / mount / insight / audit                     │
├───────────┬───────────┬───────────┬───────────┬────────────────────┤
│ souls/  ★ │ context/ ★│ generation│ jobs      │ audit/ ★           │
│ 灵魂/人格 │ 命名空间/ │ 检索→生成 │ 队列/worker│ 审计(横切)         │
│ /记忆     │ 信源/写入 │ (fan-out) │           │                    │
├───────────┴───────────┴───────────┴───────────┴────────────────────┤
│ connectors/ ★   采集层：static / dynamic(pull) / streaming(push)    │
├──────────────────────────────────────────────────────────────────┤
│ sag/    ★  引擎适配层：唯一 import zleap-sag（EngineManager）        │
│            检索层新增 **多信源 fan-out + 合并/重排**                 │
├──────────────────────────────────────────────────────────────────┤
│ core/      config · security · db · deps · errors · **logging/审计**│
└──────────────────────────────────────────────────────────────────┘
        ★ = 现有支点，演进主要发生在这些目录
```

## 演进要点（都建立在现有支点上）

1. **信源类型化**（`context/`）
   `Source` 增加 `source_type` 与 `namespace_id`。文档/网页已通，新增 `message`/`conversation`/`audio` 只是**采集与切分**不同，下游 `ingest/extract/search` 完全复用。

2. **两层组织：Namespace + Soul**（`souls/`, `context/`）
   Namespace = 信源文件夹；Soul = 名字+人格+绑定。都是 zleap 侧新表，不触碰引擎。

3. **统一写入接口 + 流式连接器**（`connectors/`）
   在现有 `Connector` 协议上加 `stream/write` 能力与 `POST /sources/{id}/messages`，支撑「动态持续写入」。缓冲→成块→复用 `process_document` 管线。

4. **多信源 fan-out 检索**（`sag/`）
   `EngineManager` 现为「一信源一引擎」。新增 `search_many(source_config_ids, query)`：并发各源 `search` → 归一化 `RetrievedSection` → 按分数/重排合并 → 交给生成层。灵魂对话即调用它（跨绑定上下文 + 会话记忆）。

5. **会话记忆闭环**（`souls/memory`）
   与灵魂对话时：定位/新建该灵魂「会话记忆」命名空间下的 `conversation` 信源 → 写入消息 → 触发 `extract` → 沉淀为可检索上下文。

6. **审计 + 日志横切**（`audit/`, `core/logging`）
   领域服务通过一个 `audit.record(actor, action, target, meta)` 钩子写不可变审计；结构化日志带 request/trace id。

7. **插件 / 挂载**（`mounts/` + 对外 MCP/Skill/Hook 适配）
   把「灵魂上下文」暴露为 MCP server / skill / hook；挂载包管理 key、Host 适配与人格备份还原。见 [plugins-and-mounts](plugins-and-mounts.md)。

## 不变的地基（已验证）

- **引擎适配隔离**：所有 zleap-sag 调用只在 `sag/`。替换/升级引擎改动收敛。
- **连接器注册表**：新增连接器 = 实现协议 + 注册（web 连接器已证明该模式）。
- **任务队列抽象**：`InProcessAsyncQueue` 现用；可平滑换 Celery/RQ。
- **错误映射 / SSE 流式 / JWT / 分层服务**：均已就位并测试。

## 关键非功能性

| 关注点 | 落点 |
|---|---|
| 可拓展 | 注册表 + 协议 + 适配层三处「插槽」 |
| 可审计 | `audit_log` 不可变 + 服务层钩子 |
| 可观测 | 结构化日志 + `/system` 健康/能力 + 任务面板 |
| 配置灵活 | 分层：env < 工作空间设置 < 信源覆盖；密钥隔离，热应用 |
| 可扩容 | 零依赖(SQLite+LanceDB) → 单库(Postgres+pgvector) → 拆分后端(ES/MySQL) |
