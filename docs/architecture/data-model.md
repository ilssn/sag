# 数据模型（演进）

> 现有表见 [as-built](../architecture.md)。本篇给出**目标 schema**，标注「现有 / 新增 / 变更」，可直接据此建模与写迁移。全部 zleap 侧元数据；引擎侧（chunks/向量/事件图谱）由 SAG 自管，zleap 只存 `sag_source_config_id` 关联。

## ER 概览

```
User ─┐                         ┌─ Namespace ─┬─ Source ──< Document
      ├─ Membership ─ Workspace ─┤             │            └─(sag_source_config_id → 引擎)
      │                          ├─ Soul ──< SoulBinding >── Namespace/Source
      │                          │     └─< Thread ──< Message
      │                          ├─ Connector(Source.config)   ← 采集配置/游标
      │                          ├─ Mount (挂载令牌/Host)
      │                          └─ AuditLog / JobLog
```

## 现有（保持）
`users` · `workspaces` · `memberships` · `documents` · `jobs` · `chat_threads` · `chat_messages` · `settings`（见 as-built）。下面是**新增与变更**。

## 变更：`sources`（信源类型化 + 归属命名空间）
```
sources
  id                pk
  workspace_id      fk workspaces
  namespace_id      fk namespaces            ★新增
  soul_id           fk souls  null           ★新增（会话记忆源归属某灵魂时置位）
  name, description
  source_type       enum(document|message|conversation|audio|web)  ★新增
  connector_kind    enum(file_upload|web|notion|feishu|slack|s3|message_api|audio…)
  sag_source_config_id  unique                （现有）
  config_json       连接器配置 + 引擎覆盖 + 采集游标(cursor)        ★扩展
  status            enum(active|paused|syncing|error)
  document_count, chunk_count, event_count
  created_at, updated_at
```

## 新增：`namespaces`
```
namespaces
  id            pk
  workspace_id  fk
  name          （如「会话记忆」「知识」「合同」）
  kind          enum(memory|knowledge|custom)   -- memory：放会话；系统默认建 memory+knowledge 各一
  icon, color   展示
  is_system     bool  -- 默认命名空间不可删
  created_at, updated_at
  UNIQUE(workspace_id, name)
```

## 新增：`souls` + `soul_bindings`
```
souls
  id            pk
  workspace_id  fk
  name          灵魂名（如「阿默」「关羽」）
  avatar        头像（emoji/url/生成）
  persona_json  人格：{ system_prompt, voice, traits[], guardrails[], greeting,
                        search_strategy, top_k, temperature }
  origin        enum(user|book_entity|mount|import)   -- 溯源：手建/书中人物/挂载/导入
  origin_ref    json  -- 如 { book_source_id, entity_id }
  memory_namespace_id  fk namespaces  -- 该灵魂的「会话记忆」空间（创建时自动建）
  status        enum(active|archived)
  created_at, updated_at

soul_bindings                      -- 灵魂能访问哪些上下文（多对多）
  id            pk
  soul_id       fk souls
  target_type   enum(namespace|source)
  target_id     id
  mode          enum(read)         -- 预留 write
  UNIQUE(soul_id, target_type, target_id)
```

## 变更：`chat_threads` / `chat_messages`（对话绑定灵魂 + 记忆落地）
```
chat_threads
  + soul_id            fk souls            ★新增（对话属于某灵魂）
  + memory_source_id   fk sources  null    ★新增（该会话沉淀成的 conversation 信源）
  source_id            → 保留兼容；灵魂对话时可空（改由 fan-out 绑定源）

chat_messages         （保持：role, content, citations_json）
  + author             string null         ★新增（多人与同一灵魂对话时标识说话人）
  + tokens, latency_ms 观测（可选）
```

## 新增：`mounts`（本地 Agent 挂载）
```
mounts
  id            pk
  workspace_id  fk
  soul_id       fk souls
  host          enum(claude_code|cursor|generic_mcp|…)
  mode          enum(knowledge|full)        -- 知识挂载 / 全量夺舍
  token         挂载令牌（作用域=该灵魂只读上下文；可吊销）
  last_seen_at  最近连接
  backup_json   full 模式下备份的旧人格（用于还原）
  status        enum(active|revoked)
  created_at
```

## 新增：`audit_log`（不可变）
```
audit_log
  id            pk
  workspace_id  fk
  actor_id      fk users null   -- 或 system/mount
  actor_kind    enum(user|system|mount|connector)
  action        string          -- source.create / soul.bind / mount.full / doc.delete / chat.ask …
  target_type   string
  target_id     string
  metadata_json 关键字段快照（脱敏）
  ip, user_agent
  created_at     （只增不改不删）
```

## 新增：`job_logs`（任务可观测）
```
job_logs
  id, job_id fk jobs, level, message, created_at
```
（`jobs` 已有 status/progress/attempts/error；job_logs 追加过程日志，供 UI 时间线与排障。）

## 迁移策略

- 用 Alembic，全部 `ADD`：新表 + `sources`/`chat_*` 新列（可空/带默认）。
- 首次启动 data-fix：为每个已有工作空间建默认 `memory`/`knowledge` 命名空间；把现有 `sources.namespace_id` 回填到「知识」。
- 引擎数据零改动。

> 命名空间 + 灵魂 + 类型化信源，是把「知识库」升级为「上下文基座」的**最小充分**模型改动。
