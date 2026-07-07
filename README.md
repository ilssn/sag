# muse

> **新一代 Agentic Data Manager · Context Infrastructure**
> 个人的信息助手，企业的决策大脑，Agent 的灵魂。

`muse` 以 [`zleap-sag`](https://pypi.org/project/zleap-sag/)（本地优先的记忆 / 知识引擎）为**数据基座**，把「上下文」做成一等公民：持续汇聚文档、消息、会话、录音，结构化为事件—实体图谱，再以**灵魂（Soul）**的形态提供给人和 Agent。

不是又一个「文档问答」——检索问答只是上下文的一种消费方式。muse 关注上下文的**全生命周期**：获取 → 结构化 → 记忆 → 提供 → 拓展。对标并超越 RAGFlow，目标是**开源级爆款、企业标杆**。

> 📐 **愿景与蓝图见 [docs/](docs/README.md)** —— [产品愿景](docs/product/vision.md) · [核心概念模型](docs/product/concepts.md) · [演进架构](docs/architecture/overview.md) · [路线图](docs/roadmap.md)。
> 本 README 描述**当前已实现**的能力（Phase 0：知识库地基）。

## 现状能力（Phase 0，已实现）

- **从信息源到答案** — 上传/抓取文档 → 自动解析入库与事件抽取 → 带引用的流式问答。
- **多信源 / 多用户** — 每个「信源」对应引擎中的一个独立数据源；工作空间隔离。
- **可插拔连接器** — 采集层抽象 + 注册表。已内置**文件上传**与**网页同步**；新增连接器即插即用。
- **渐进式部署** — 本地零依赖（SQLite + LanceDB），生产一键切 Postgres + pgvector 单库。
- **克制的设计** — 纸墨极简 + 淡金强调，亮暗双主题，风格化统一。

## 演进方向（Phase 1+，见 docs）

命名空间（文件夹式组织） · **灵魂 + 人格**（跨源 fan-out 对话） · **会话记忆闭环**（越聊越懂你） · 消息/会话/录音信源与统一持续写入 · **MCP / 本地 Agent 挂载与「夺舍」** · 洞察与**书→人物** · 企业级审计/RBAC/可观测。

## 快速开始

### 本地开发（零依赖）

```bash
# 后端
cd apps/api
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # 填入 OpenAI 兼容的 LLM / embedding 配置
uvicorn muse_api.main:app --reload

# 前端
cd apps/web
npm install
npm run dev
```

打开 http://localhost:3000 ，首次注册的账号即成为管理员。

### 生产（docker compose）

```bash
cd deploy
cp .env.example .env
docker compose up -d          # web + api + postgres(pgvector)
```

## 架构

```
apps/api   FastAPI + zleap-sag（适配层 / 连接器 / 任务队列 / 生成层 / 领域服务）
apps/web   Next.js 15 + shadcn/ui + Tailwind（App Router）
deploy     docker-compose + Dockerfile + .env
docs       架构与拓展文档
```

详见 [docs/architecture.md](docs/architecture.md)。

## 许可

MIT
