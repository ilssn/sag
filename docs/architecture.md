# muse 架构（as-built · 与代码同步）

> 本篇描述**当前已实现**的系统。目标态设计见 [architecture/](architecture/overview.md)，两者差距见 [roadmap](roadmap.md)。

## 定位

muse = **产品层**（命名空间 / 灵魂 / 记忆 / 连接器 / 生成 / UI）覆盖在 `zleap-sag`（**引擎层**：解析·分块·向量·事件-实体图谱·检索）之上。

> 关键分工：**引擎只做检索**（`search` → 排序段落），**不做答案生成**。muse 自持「检索 → 人格化提示词 → LLM 流式合成 → 引用」。

## 分层（后端 `apps/api/muse_api`）

```
api/v1/        HTTP 路由：auth · namespaces · sources · documents(+ingest) ·
               insights(entities/to-soul) · jobs · search · souls(+bindings/threads/ask) ·
               chat(快速问答) · system
services/      领域逻辑（纯，不依赖 FastAPI）：auth / namespace / source / document /
               chat / soul(绑定·解析·记忆) / insight(实体→灵魂)
jobs/          队列抽象 + 进程内 asyncio worker + 处理器（process_document / sync_source）
generation/    LLM 客户端(OpenAI 兼容) · 提示词(含灵魂人格注入) · 引用(带信源名) · 人格生成
sag/       ★  引擎适配层：全项目唯一 import zleap-sag 之处
connectors/ ★  采集抽象 + 注册表（file_upload / web）
db/            SQLAlchemy 2.0 异步模型
core/          config(pydantic-settings) · security(JWT/bcrypt) · db(含轻量列迁移) ·
               deps · errors(领域异常→HTTP) · logging
```

## 核心概念与数据模型

| 概念 | 表 | 说明 |
|---|---|---|
| 工作空间 | `workspaces` / `memberships` | 多租户边界；注册即建，首用户 admin |
| **命名空间** | `namespaces` | 信源文件夹；`memory`/`knowledge` 系统默认，`custom` 自建 |
| **信源** | `sources` | 1:1 引擎 `source_config_id`；`source_type`(document/web/message/conversation/audio)；归属命名空间；会话记忆源带 `soul_id` |
| 文档 | `documents` | 状态机 `pending→loading→extracting→ready|failed`，计数回填 |
| 任务 | `jobs` | queued/running/succeeded/failed + 进度；启动恢复残留任务 |
| **灵魂** | `souls` | 名字 + 头像 + `persona_json`(system_prompt/greeting/guardrails/top_k…) + `origin`(user/book_entity/…) |
| 绑定 | `soul_bindings` | 灵魂 ↔ 命名空间/信源（多对多，含归属校验与去重） |
| 灵魂会话 | `soul_threads` / `soul_messages` | 会话（含 `memory_source_id`）与消息（含引用快照、author） |
| 快速问答 | `chat_threads` / `chat_messages` | 单信源问答（工具位） |

## SAG 适配层（`sag/engine_manager.py`）

- `EngineManager`：按 `source_config_id` 懒构造并缓存 `DataEngine`（一实例一源，`health_check=False` + `start()`），每源一把锁串行化。
- `process_document`：ingest → extract，阶段回调驱动文档状态机。
- `search` / **`search_many`**：单源检索 / **多源并发 fan-out**（去重 chunk_id、按分归并、单源失败不阻断）。
- **`list_entities` / `entity_context`**：经引擎 `get_session_factory()` 读事件-实体图谱（`entity`/`source_event`/`event_entity`），按热度（关联事件数）排序 —— 洞察与「书→人物」的数据来源。
- 错误映射：`SagError` 家族 → muse 领域异常 → 统一 HTTP 响应体。

## 关键流程

**上传/写入 → 处理**
```
上传文件 或 POST /documents/ingest(text|messages 标准格式)
  → 落盘 + Document(pending) + Job 入队
worker → EngineManager.process_document
  → loading(解析·分块·向量) → extracting(事件/实体，可降级 0 事件)
  → ready + 计数回填（Source 原子累加）
```

**灵魂对话（fan-out + 人格 + 记忆闭环）**
```
POST /souls/{id}/threads/{tid}/ask  (SSE)
  1 resolve_sources：展开绑定(命名空间→其下信源) ∪ 自身 conversation 记忆源
  2 search_many 跨源检索 → 引用（带 source_name）
  3 build_soul_messages：persona.system_prompt + guardrails + 资料 + 历史
  4 流式 meta(citations) → token* → done
  5 persist_answer（独立会话落库）
  6 remember_exchange：本轮问答 → 懒建「与 X 的对话」conversation 信源 → 入队
     ingest/extract → 下次可被检索（越聊越懂你）
```

**书 → 人物**
```
GET /sources/{id}/entities        实体热度榜（频次代理中心度）
POST /entities/{eid}/to-soul      收集实体相关事件片段 → generate_persona(LLM，
                                  无 LLM 回退模板) → 建灵魂(origin=book_entity) → 绑定该书
```

## 前端（`apps/web`，Next.js 15 App Router）

- 导航：**概览 / 灵魂 / 上下文 / 设置**；`/ask` 为「快速问答」工具位（信源详情入口）。
- **ConversationView**：信源问答与灵魂对话共用的对话组件——rAF 批量 token 刷新、加载竞态防护、流式结束强制回读、Markdown 渲染（GFM 表格/引用/标题已排版）、引用展开（含来源信源名）。
- 设计系统：纸墨 + 淡金令牌（`globals.css`），亮暗双主题；统一 ConfirmDialog / 表单对话框 / 空态 / 骨架。
- 鉴权：JWT cookie + middleware 守卫 + API 客户端 Bearer；SSE-over-fetch（`lib/sse.ts`）。

## 存储（渐进式）

- 本地零依赖：muse 元数据 SQLite + 引擎 LanceDB/SQLite（`data_dir`）。
- compose 生产：单 Postgres —— 元数据 + 引擎 `pgvector`（`deploy/docker-compose.yml`）。
- dev 演进列由 `core/db.py` 幂等 `ADD COLUMN`；生产迁移预留 Alembic。

## 质量基线

- `pytest`：14 项（HTTP e2e、连接器、灵魂绑定/解析、记忆闭环、实体→灵魂），全部离线可跑。
- `ruff` 全绿（line-length 120）；`next build` 全路由类型检查通过。
- LLM/embedding 未配置时：上传/解析/入库可用（降级），问答/抽取给出明确 4xx 与 UI 提示。
