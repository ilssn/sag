# muse

> 从信息源到知识问答的开源知识库平台 · An open, elegant knowledge base — from sources to answers.

`muse` 基于 [`zleap-sag`](https://pypi.org/project/zleap-sag/)（本地优先的记忆 / 知识引擎）构建。引擎负责解析、分块、向量化、事件—实体图谱与检索；muse 在其上补齐产品化能力：**多用户、多信源、后台处理编排、带引用的答案生成、精致的 UI/UX、一键 `docker compose`**。

对标 RAGFlow，但更**清晰、克制、易拓展、好维护**。

## 特性

- **从信息源到答案** — 上传文档 → 自动解析入库与事件抽取 → 带引用的流式问答。
- **多信源 / 多用户** — 每个「信源」对应引擎中的一个独立数据源；工作空间隔离。
- **可插拔连接器** — 采集层抽象。当前内置文件上传，后续可插入 Web / Notion / S3 等动态同步连接器。
- **渐进式部署** — 本地零依赖（SQLite + LanceDB），生产一键切 Postgres + pgvector 单库。
- **克制的设计** — 纸墨极简 + 淡金强调，亮暗双主题，风格化统一。

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
