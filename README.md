# sag

<p>
  <img alt="version" src="https://img.shields.io/badge/version-v1.0.0-18181b" />
  <img alt="python" src="https://img.shields.io/badge/python-3.11+-3776ab" />
  <img alt="node" src="https://img.shields.io/badge/node-20+-339933" />
  <img alt="shadcn/ui" src="https://img.shields.io/badge/ui-shadcn-000000" />
  <img alt="MCP" src="https://img.shields.io/badge/protocol-MCP-6b7280" />
</p>

> **一个干净、清晰、好用的 SAG 开源示范项目 —— 带知识库的 Agent 客户端。**
> 对话是主入口（单 agent 开箱即用）；上传文档进知识库 → 搜索/溯源 → 带引用对话。信源即 MCP。

`sag` 以 [`zleap-sag`](https://pypi.org/project/zleap-sag/)（本地优先的知识引擎：解析 · 分块 · 向量 · 事件—实体图谱 · 检索）为数据基座，用最短的链路把 SAG 的能力示范清楚。**个人向、单用户、零基础设施**——没有多租户、没有团队权限、没有一堆待接线的组件，只留下一条主干：

**信息进来（信源 + 文档）→ 检索得到有据的结果（搜索 + 原文溯源）→ Agent 依据信源带引用作答，并可经 MCP 扩展工具。**

- 🧩 **MCP 一等公民**：每个信源都是一个 MCP 端点，可挂进 Claude Desktop / Cursor；Agent 也作为 MCP 客户端，挂载自己的信源与更多外部 MCP 工具。
- 🔎 **一步溯源**：回答里的引用 `[n]` 可点开看原文分块。
- 🤖 **Agent 即模型**：任意 Agent 暴露一个 OpenAI 兼容端点，可当作「带检索与引用的模型」调用。

## 核心概念（三个）

- **信源（Source）** — 装内容的容器。上传文档，sag 自动解析、分块、向量化、抽取事件与实体。每个信源同时是一个可对外挂载的 **MCP 端点**。
- **Agent** — 绑定若干信源、带设定（system prompt / 开场白），依据信源带引用作答；可挂载外部 MCP server 扩展工具。
- **搜索（Search）** — ⌘K 全局唤出，可锁定信源范围，命中即可跳到原文。

## 快速开始（零依赖，单用户）

```bash
# 后端
cd apps/api
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # 可选：预填 OpenAI 兼容的 LLM / embedding（也可启动后在界面里配）
uvicorn sag_api.main:app --reload      # http://localhost:8000

# 前端
cd apps/web
npm install
npm run dev                   # http://localhost:3000
```

- **首个注册用户即你的账号。** 引导完成后可在 `.env` 设 `SAG_ALLOW_REGISTRATION=false`，此后不再开放注册。
- **模型可视化配置**：登录后在 **设置 → 模型** 里填 LLM / 向量模型（Base URL、API Key、模型、温度、检索策略…），**保存即生效、无需重启**，并可一键「测试连接」。也可继续用 `.env` 的 `SAG_LLM_*` 预置。
- 未配置 LLM 也能启动、建信源、上传文档；仅**事件抽取**与**问答**需要模型。
- 默认零基础设施：元数据 SQLite（`./.data/sag.db`）+ SAG 存储 LanceDB（`./.data/engine`）。**升级后若旧库结构不兼容，删除 `apps/api/.data/` 后重启即重建。**

### 三步走完主干

1. **知识库建信源、上传文档** —— 自动解析、分块、向量化、抽取事件与实体。
2. **搜索看结果、点开右栏查原文** —— 验证召回，chunk 级可核查。
3. **直接对话** —— 默认助手已就绪（无需创建），回答带引用，点引用开右栏溯源。

## 信源即 MCP

每个信源都暴露一个标准 MCP 端点，提供三个工具：`search`（检索证据）· `get_entity`（查实体上下文）· `get_chunk`（读原文分块）。

**拿到某个信源的挂载信息：**

```bash
curl -s http://localhost:8000/api/v1/sources/<SOURCE_ID>/mcp \
  -H "Authorization: Bearer <SAG_JWT>"
```

返回 HTTP（Streamable-HTTP）URL 与 stdio 配置片段两种接法。前端「信源详情 → 作为 MCP 挂载」也能直接复制。

**挂进 Claude Desktop / Cursor（stdio）：**

```jsonc
{
  "mcpServers": {
    "sag-<信源名>": {
      "command": "python",
      "args": ["-m", "sag_api.mcp.server"],
      "env": { "SAG_MCP_SOURCE_ID": "<SOURCE_ID>" }
    }
  }
}
```

**HTTP 接法**：宿主填 `http://<host>/mcp/?source_id=<SOURCE_ID>`，并在 `Authorization` 头携带 `Bearer <token>`。

### Agent 挂载 MCP 扩展工具

Agent 除了绑定信源作答，还能挂载**外部 MCP server**（本地 filesystem、检索、你自建的工具……）。在「Agent → 连接 → MCP server」里填 HTTP url 或本地命令（如 `npx -y @modelcontextprotocol/server-filesystem /data`）即可；对话中模型可直接调用这些工具，与内置检索一视同仁。

> 设计取舍：Agent 自身对绑定信源的检索走**进程内暖引擎**（快、无多余往返）；同一套能力经 MCP server 对**外部宿主**开放。“信源即 MCP” 是对外契约，内部则直连引擎——同源同解。

## Agent 作为模型被调用（OpenAI 兼容）

任意 Agent 暴露一个 OpenAI Chat Completions 端点，检索与引用与站内一致：

```bash
curl -s http://localhost:8000/api/v1/openai/<AGENT_ID>/chat/completions \
  -H "Authorization: Bearer <SAG_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"这份资料讲了什么？"}]}'
```

返回标准 `chat.completion`，额外带 `sag.citations` 引用字段（标准客户端忽略未知字段）。`"stream": true` 时以 SSE 分块返回。

## 架构一览

```
apps/web   Next.js 15 + shadcn/ui（中性主题，亮暗双色，⌘K 全局搜索）
apps/api   FastAPI · services 纯领域 · sag/ 唯一引擎适配层 · jobs 进程内队列（退避重试）
           tools/ Agent 工具层（内置检索/实体 + MCP 适配）· mcp/ 信源 MCP server + HTTP 挂载
           · 引擎槽 LRU · 就绪/存活探针 · OpenAI 兼容端点
zleap-sag  解析 · 分块 · 向量 · 事件—实体图谱 · 检索（只做检索，不做生成）
```

数据模型（单用户、极简）：

```
User    { email, password_hash, name, is_active }
Source  { name, description, connector_kind, config, sag_source_config_id, 计数… }   # 同时是 MCP 端点
Document{ … }
Agent   { name, avatar, persona{ system_prompt, greeting, tools[] } }
Binding { agent_id, target_type(source|mcp_server), target_id, config }             # 绑信源 / 挂 MCP
Thread / Message { … 带 citations }
```

深入阅读 → [docs/architecture.md](docs/architecture.md) · [Agent · MCP · 图谱](docs/architecture/agent-mcp-graph.md)

## 工程规范（本项目同时是一份最佳实践）

sag 的每一层都以「可被引用的范本」为标准交付——分层架构与错误模型、测试纪律、
shadcn/ui 落地与 token 纪律、知识库与 Agent 设计原则，全部成文并与代码互相校验：

**[docs/standards/](docs/standards/README.md)** — 价值理念 · [架构](docs/standards/architecture.md) · [前端](docs/standards/frontend.md) · [产品](docs/standards/product.md) ｜ 参与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 许可

见 [LICENSE](LICENSE)。基于 [`zleap-sag`](https://pypi.org/project/zleap-sag/) 引擎构建。
