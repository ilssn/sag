# sag 架构（as-built · 与代码同步）

> 本篇描述**当前已实现**的系统：单用户、Agent + 信源 + MCP。

## 定位

sag = **产品层**（信源 / Agent / 工具 / MCP / 生成 / UI）覆盖在 `zleap-sag`（**引擎层**：解析·分块·向量·事件-实体图谱·检索）之上。单用户、零基础设施，用最短链路示范 SAG。

> 关键分工：**引擎只做检索**（`search` → 排序段落），**不做答案生成**。sag 自持「检索 → 提示词 → LLM 流式合成 → 引用」。

## 分层（后端 `apps/api/sag_api`）

```
api/v1/        HTTP 路由：auth · sources(+chunks 溯源 · /mcp 描述) · documents ·
               jobs · search(单源 + /search 全局 fan-out) ·
               agents(+bindings/threads/ask) · insights(实体读) · openai · system
services/      领域逻辑（纯，不依赖 FastAPI）：auth / source / document /
               agent_domain(CRUD·绑定·对话计划) / agent_service(SDK 宿主适配) / insight
tools/     ★  Agent 工具层：Tool ABC + 注册表 + 内置(检索/实体) + mcp(远端工具适配)
mcp/       ★  信源即 MCP：FastMCP server(检索/实体/文档/原文工具) + Streamable-HTTP 挂载
jobs/          队列抽象 + 进程内 asyncio worker + 处理器(process_document / sync_source)
generation/    LLM 客户端(OpenAI 兼容, 支持 function-calling) · 提示词 · 引用(带信源名)
sag/       ★  引擎适配层：全项目唯一 import zleap-sag 之处
connectors/ ★  采集抽象 + 注册表(file_upload / web)
db/            SQLAlchemy 2.0 异步模型
core/          config · security(JWT/bcrypt) · db · deps(仅认证 + 单例注入) · errors · logging
```

## 核心概念与数据模型（单用户 · 极简）

| 概念 | 表 | 说明 |
|---|---|---|
| 用户 | `users` | 单用户；`email / password_hash / name / is_active`（无角色/工作空间） |
| **信源** | `sources` | 1:1 引擎 `sag_source_config_id`；`source_type`(document/web/message/audio)；同时是一个 MCP 端点 |
| 文档 | `documents` | 状态机 `pending→loading→extracting→ready\|failed`，计数回填 |
| 任务 | `jobs` | queued/running/succeeded/failed + 进度；启动恢复残留任务 |
| **Agent** | `agents` | 名字 + 头像 + `persona_json`(system_prompt / greeting / tools[]) |
| 绑定 | `agent_bindings` | Agent ↔ 目标：`target_type`(source / mcp_server) + `target_id` + `config`(MCP 连接) |
| 会话 | `threads` / `messages` | 会话与消息（消息含引用快照 `citations`） |

## SAG 适配层（`sag/engine_manager.py`）

- `EngineManager`：按 `sag_source_config_id` 懒构造并缓存 `DataEngine`（一实例一源），每源一把锁串行化，超上限 LRU 逐出空闲槽。
- `process_document`：ingest → extract，阶段回调驱动文档状态机。
- `search` / **`search_many`**：单源检索 / 多源并发 fan-out（去重 chunk_id、按分归并、单源失败不阻断）。
- `list_entities` / `entity_context` / `get_chunk`：实体图谱读 + 原文分块溯源。

## Agent Runtime（`apps/api/sag_agent`）

Agent 编排已从 `sag_api` 业务代码抽离为平级、零运行时依赖的 `sag_agent` Core。核心提供
`Agent`、`AgentRuntime`、`RunHandle`、版本化事件、工具并行/超时/审批、取消和 `RunStore`；
模型供应商、SAG/MCP 工具、数据库与 SSE 都是宿主 adapter。

- **单一模型协议**：每轮只调用 `stream_turn` 一次，文本与原生 function calling 共用一条流。
- **内置工具**（`tools/builtin.py`）：`search_context`（绑定信源检索）· `get_entity`（实体上下文）。
- **MCP 工具**（`tools/mcp.py`）：远端 MCP 工具在请求作用域内适配为 SDK `AgentTool`。
- **信源解析**：输入框 `@` 指定的信源优先；未指定时，默认 Agent 使用全部信源，自定义 Agent 使用持久绑定。
- **工具挂载**：本轮存在可见信源时自动挂载检索/实体工具；外部 MCP binding 在 run 开始时连接、结束时释放。
- **检索质量**：`search_context` 合并语义召回与正文精确词窗口；精确正文存在时过滤导航、排行榜等模板噪音。
- **生命周期**：FastAPI lifespan 启动一个进程级 runtime；请求只创建 run。
- **控制面**：按 agent/thread 校验的 cancel/approve/reject 端点。

完整契约见 [Agent Runtime 架构](architecture/agent-runtime.md)。

## 信源即 MCP（`mcp/`）

一个 sag 实例只有**一个** FastMCP server（检索、实体、文档枚举、大纲、精确匹配与原文读取），服务哪个信源由请求作用域（contextvar）决定：

- **HTTP**（`mcp/mount.py`）：Streamable-HTTP 挂在 `/mcp/`，中间件解析 `?source_id=` + JWT 校验 + 注入作用域；session manager 在应用 lifespan 内运行。外部宿主（Claude Desktop / Cursor）填 `/mcp/?source_id=<id>`。
- **stdio**（`python -m sag_api.mcp.server`，env `SAG_MCP_SOURCE_ID`）：面向仅支持 stdio 的宿主。
- 处理器直接调**暖 `EngineManager`**——外部宿主与进程内 Agent 复用同一 server 定义与同一引擎，同源同解。
- `GET /api/v1/sources/{id}/mcp` 返回挂载信息（HTTP url + stdio 配置片段），前端「信源详情 → 作为 MCP 挂载」可复制。

## 认证与请求

- 单用户 JWT（`core/deps.get_current_user`）：登录用途，无角色/空间过滤。首个注册即账号；`SAG_ALLOW_REGISTRATION=false` 关闭后续注册。
- 错误：领域异常（`core/errors`）经处理器映射为 HTTP（404/409/422/401/400…）。
- 生成/对话直接透传版本化 SDK 事件：`run.started → turn/message/tool* → run.completed|failed|cancelled`。

## OpenAI 兼容端点（`api/v1/openai.py`）

任意 Agent 暴露 `POST /api/v1/openai/{agent_id}/chat/completions`（无状态，`thread_id=None`，不落库）：复用同一套检索/工具循环/引用，返回标准 `chat.completion` + `sag.citations`；`stream:true` 走 SSE。

## 桌面形态（`apps/desktop`，ADR-0023）

Electron 壳拉起 `sag-api serve` sidecar（PyInstaller onedir），经 stdout JSONL 启动协议
（ADR-0017）门控就绪后，以 `app://sag` 托管 web 静态导出并经 preload 注入运行时配置
（ADR-0007）。数据落平台应用目录单根（ADR-0012），启动顺序 实例锁 → Alembic 迁移 →
引擎数据版本门 → 业务开放；失败进维护模式仅开放 `/system/*`。工程细节见
[desktop.md](desktop.md)。

## 前端（`apps/web`）

Next.js 15 + shadcn/ui（中性主题，亮暗双色）。Sidebar 应用外壳（搜索 / 知识库 / 新对话）；引用抽屉一步溯源；Agent 对话支持工具步骤、审批和停止。搜索结果可在列表与关系图谱间切换，图谱的片段节点沿用同一原文入口。`lib/api.ts` 是单一 API 客户端，`lib/sse.ts` 消费版本化问答事件。
