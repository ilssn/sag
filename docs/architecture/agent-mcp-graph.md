# Agent 解耦 · MCP · 图谱 —— 从旧版 SAG 承接三大策略

> 指导文档。分析旧版产品 **[Zleap-AI/SAG](https://github.com/Zleap-AI/SAG)** 里值得保留的三条策略，
> 给出它们在**新版 sag**（Python FastAPI + Next.js + zleap-sag 引擎）里的目标架构与分阶段落地。
>
> **落地状态**：**(A) Agent 解耦（工具层）已实现** · **(B) MCP —— 信源即 MCP + Agent 作 MCP 客户端已实现**
> （见 [../architecture.md](../architecture.md) 的「Agent 工具循环」「信源即 MCP」，及后端 `tools/`、`mcp/`）· **(C) 图谱展示 待做**。
> 与旧版差异：Agent 循环用**原生 function-calling**（非 JSON-planner ReAct）；MCP 传输为 **Streamable-HTTP + stdio**；
> 检索工具直连**暖引擎**（进程内），对外则以 MCP server 暴露同一能力。

## 为什么

旧版 SAG 有三条设计新版要保留：**(1) Agent 独立化/解耦**（先自建工具层、之后可挂载工具，更灵活）；
**(2) MCP**（Agent 通过 MCP 绑定外部工具）；**(3) 图谱展示**（融入搜索，结果可切换 列表/图谱）。

关键前提：**SAG 是独立 TypeScript 应用**（Fastify + React/Vite + Postgres/pgvector），
**不能直接移植代码**；但三套设计很干净，可在我们栈里重实现，且引擎侧数据/抽象已具备承接条件。

---

## 一、旧版 SAG 的三套设计（值得保留）

SAG 技术栈：TypeScript 全栈、Fastify、`@modelcontextprotocol/sdk`、`@xyflow/react`（React Flow v12）、
Postgres + pgvector。SAG 本身是检索方法（论文）+ 实现它的应用；无独立引擎依赖。

### A. Agent = 单一通用的工具调用执行器（`src/services/mcp-agent-service.ts`）
- **检索完全解耦**：agent 不知道 RAG 细节，运行时 `client.listTools()` 发现工具，`sag_search` 只是其中之一；换 MCP server 即换能力。
- 一个 agent 实例 = 一个持久化会话（`mcp_sessions`），绑定一个项目（env 预绑定，工具参数从不带项目 id）。
- 执行是**有界 JSON-planner ReAct 循环**（≤6 步，plan→act→observe）：用 `response_format:json_object` 让模型返回 `{"action":"call_tool"|"final",…}`，**不是原生 function-calling**；无 LLM key 时退化为**正则路由**（离线可测）。
- 工具结果流式回传（MCP progress 通知），并汇总为编号引用 `[1][2]`。

### B. MCP：server + client 双向（`@modelcontextprotocol/sdk`，stdio）
- **Server**（`src/mcp/server.ts`）：`server.tool(name, zodSchema, handler)` 注册 4 个工具（`sag_search`/`sag_ingest_document`/`sag_explain_search`/`sag_get_event`）；项目通过 env `SAG_MCP_SOURCE_ID` 预绑定。
- **Client**（在 agent service 内）：`new Client()` + `StdioClientTransport` 把 server 当子进程拉起；`listTools()` → LLM 规划 → `callTool()`。
- 对外暴露 `mcpServers` 配置（Claude Desktop/Cursor 形状）——**SAG 本身可被外部 agent 挂载**。

### C. 图谱：React Flow 二部图（`web/src/components/ProjectGraphFlow.tsx`）
- **实体↔事件二部图**，契约 `{entities:[{id,type,name,eventCount}], events:[{id,title,rank,entityIds}], edges:[{entityId,eventId}]}`。
- 单端点 `GET /projects/:id/graph` + 两条 GROUP BY SQL；前端 React Flow + **自研确定性放射状布局**（最高度中心、事件走黄金角螺旋）、**渐进展开/折叠**、邻居高亮、双击详情。

---

## 二、新版 sag 现状与差距（代码实证）

| | 现状（文件） | 差距 |
|---|---|---|
| **A. Agent** | `db/models/soul.py`：Soul=名字+人格+绑定+记忆命名空间，**无工具概念**；`services/soul_service.py:build_ask_context` 把检索写死为必经步骤；`generation/llm.py:stream/complete` 不传 `tools=`、丢 `tool_calls` | 检索=写死；无工具层；LLM 无工具调用能力 |
| **B. MCP** | 代码**完全没有**（仅 docs 提到 sag-**作为** server 对外）；`BindingTargetType`={namespace,source}；`SoulBinding` 通用但无 config 列 | 无 MCP 客户端；绑定无法指向 MCP server |
| **C. 图谱** | 数据**已在引擎表**：`Entity`↔`SourceEvent` 经 `EventEntity`（带 weight + 角色 description）；`engine_manager.list_entities` 已用 `get_session_factory()` 读 | `EntityInfo` DTO 窄；仅 `GET /sources/{id}/entities`；**无 events/edges 端点**；**前端零可视化、无图库** |

**可复用的现成模式**（不造轮子）：
- `connectors/base.py`+`registry.py`：`Connector` ABC + `ConfigField`/`to_public()` 自描述 + 单例 register/get/all —— **工具层照抄**。
- `jobs/tasks.py`+`inproc.py`：`TASK_HANDLERS` 字典派发 + 单例注入 —— **工具执行照抄注入模式**。
- `core/deps.py`/`app.state` 单例注入（`get_engine_manager`）。
- 生成侧现成件：`AskPlan`/`build_citations`/`build_prompt_preview`/`build_soul_messages`/`remember_exchange`。

---

## 三、目标架构（三能力在我们栈里）

### A. Agent 解耦（工具层）—— ✅ 第一阶段已实现
把「检索=写死必经」变「检索=一个工具」，Agent 变**工具调用执行器**，且**默认行为逐字节不变**。

- **`tools/` 包**（镜像 `connectors/`）：
  - `base.py`：`Tool` ABC；`ToolMeta{name, description, parameters(JSON-Schema)}` + `to_openai_schema()`；`ToolContext{engine_manager, sources, persona, soul}`；`ToolResult{content, citations, data}`。
  - `registry.py`：`ToolRegistry` 单例（register/get/has/all/`schemas(names)`）。
  - `builtin.py`：`SearchContextTool`（`search_context`，包 `engine_manager.search_many`，返回片段+引用）、`GetEntityTool`（`get_entity`，包 `list_entities`/`entity_context`）。
- **`generation/llm.py`**：新增 `chat(messages, tools=) -> ChatTurn{content, tool_calls}`（原生 function-calling、非流式，用于工具「决策」步）；`stream()` 仍供**最终答案**流式。
- **`services/agent_service.py:generate_stream(...)`**：产出事件流 `meta → (tool)* → token* → done/error`。
  - **短路**：检索空 + `persona.empty_response` → 直接回兜底、不调 LLM（离线可跑）。
  - **有界工具循环**：仅当 `persona.tools`（额外工具名列表）非空且 LLM 已配置时进入；`llm.chat(tools=schemas)` → 有 `tool_calls` 则派发注册表、回填 `role:"tool"` 结果并汇总 citations → 否则收尾；最终答案走 `llm.stream()`。步数上限 `AGENT_MAX_STEPS`。
  - **向后兼容**：未开启 `persona.tools` 的助手**跳过循环**，等价旧版单发；SSE 契约、`empty_response` 短路、记忆闭环、`prompt_preview`、citations 全部保留。
  - **无状态复用**：`thread_id=None`（OpenAI 端点）→ 跳过落库/记忆。
- **接线**：`core/deps.get_tool_registry`；`api/v1/souls.py:ask` 与 `api/v1/openai.py` 改调 `generate_stream`。

> 说明：本阶段检索经 `SearchContextTool` 落到工具层（`build_ask_context` 的自动播种仍保「永远有据」）；
> 额外工具（`get_entity`、以及下阶段的 MCP 工具）由 `persona.tools` 显式开启后进入模型驱动的循环。

### B. MCP 绑定 —— 第二阶段（依赖 A 的工具层）
- **Agent 作 MCP 客户端**（核心诉求）：`tools/mcp.py` 用 Python `mcp` SDK 连外部 MCP server（stdio/http），`list_tools()`，把每个远端工具**适配成同一个 `Tool` 接口**——本地工具与远端 MCP 工具对 agent 循环完全一致。
  - 新 `BindingTargetType.MCP_SERVER`；MCP server 连接配置存新表或给 `SoulBinding` 加 `config` JSON 列（`Source.config` 是先例）；`add_binding` 增校验分支；新 `resolve_tools(soul)` 汇总「内置 + 该 soul 绑定的 MCP 工具名」并注入 `persona.tools` 等价的循环入口。
  - 前端 `binding-dialog.tsx` 增 MCP 绑定入口（复用 `ConfigField` 式动态表单填 command/args/env 或 url）。
- **sag 作 MCP 服务器**（补充，`docs/architecture/plugins-and-mounts.md` 已有蓝图）：把 `search_context`/`get_entity`/`remember` 用 Python `mcp` SDK 暴露成 stdio server，token-scoped 到某 soul，供 Claude Desktop/Cursor 挂载。

### C. 图谱（融入搜索：列表 ⇄ 图谱）—— 第三阶段
- **后端**：`EngineManager.event_graph(scid)`（同 `get_session_factory()` 读 `SourceEvent`+`EventEntity`）；新端点返回 SAG 同形契约 `{entities:[{id,type,name,heat,…}], events:[{id,title,rank,entity_ids}], edges:[{entity_id,event_id,weight,role}]}`；加宽 DTO（补 type/typed-values/synonyms/weight/role）；可选 `EventEntity` 自连接派生**实体共现**边。
  - **查询范围子图**：由检索命中的 `chunk_id` → 关联 `SourceEvent.chunk_id` → events → entities，得「本次搜索的子图」。
- **前端**：`apps/web` 加 `@xyflow/react`（同 SAG）；**搜索浮层/结果加「列表 / 图谱」切换**——图谱端渲染本次查询子图（实体按 `EntityType` 上色、尺寸按 heat、双击详情）；移植 SAG 的确定性放射状布局；复用现成未用的 `chart-1..5` 令牌上色。

---

## 四、SAG ↔ sag 映射表

| 能力 | 旧版 SAG（TS） | 新版 sag（Python/Next） |
|---|---|---|
| 工具抽象 | `server.tool(name, zodSchema, handler)` | `Tool` ABC + `ToolMeta(JSON-Schema)` + `ToolRegistry` |
| Agent 循环 | JSON-planner ReAct（≤6 步，json_object） | 原生 function-calling 循环（`llm.chat(tools=)`，≤`AGENT_MAX_STEPS`），最终答案 `stream()` |
| 检索作为工具 | `sag_search` MCP 工具 | `SearchContextTool`（包 `search_many`） |
| 离线兜底 | 无 key → 正则路由 | 无 key → 短路/跳过循环（`empty_response`） |
| MCP | `@modelcontextprotocol/sdk`（server+client, stdio） | Python `mcp` SDK：client 适配远端工具为 `Tool`；server 暴露 sag 工具 |
| 绑定 | env `SAG_MCP_SOURCE_ID` 预绑定 | `SoulBinding` + `BindingTargetType.MCP_SERVER`（+config） |
| 图谱数据 | `entities/event_entities/events` 两条 GROUP BY | 引擎表 `Entity/EventEntity/SourceEvent`（`get_session_factory()`） |
| 图谱契约 | `{entities,events,edges}` | 同形 `{entities,events,edges}`（加 weight/role/heat） |
| 图谱前端 | React Flow v12 + 放射状布局 | `@xyflow/react` + 移植布局，**融入搜索列表/图谱切换** |

---

## 五、分阶段路线

1. **Agent 解耦（工具层）— ✅ 已实现**：`tools/` 包 + `LLMClient.chat(tools=)` + `agent_service.generate_stream` + 接线 + `tests/test_agent_tools.py`。默认行为不变，`persona.tools` 开启工具循环。
2. **MCP 绑定**：`tools/mcp.py` 客户端 + `BindingTargetType.MCP_SERVER` + `resolve_tools` + 前端绑定 UI；（可选）sag 作 MCP server 对外。
3. **图谱融入搜索**：`event_graph` 端点 + 加宽 DTO + 查询子图；`@xyflow/react` 前端 + 搜索列表/图谱切换。

每阶段独立可验证（新增 pytest + ruff + 前端 tsc/build，离线可跑），单独提交推 `dev`。
