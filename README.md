# zleap

> **生产级开源知识库 · 团队的上下文基座**
> 上传信息 → 自动记忆 → 带引用对话，个人与公司同一套模型。

`zleap` 以 [`zleap-sag`](https://pypi.org/project/zleap-sag/)（本地优先的记忆 / 知识引擎）为数据基座，把「上下文管理」做成可直接部署的产品：文档、对话、记忆持续汇入一个**记忆体**，结构化为分块—事件—实体，再经**搜索、助手、OpenAI 兼容端点**对外提供。

不是又一个「文档问答 demo」。zleap 面向**个人与企业的长期可用**：四个概念、轻量依赖、记忆即本能、一步溯源、开箱审计、团队权限——对标并在这些维度上超越 RAGFlow。

- 🧭 **产品形态定稿** → [docs/product/product-form.md](docs/product/product-form.md)
- 🏛 **as-built 架构** → [docs/architecture.md](docs/architecture.md)
- 🔬 **竞品调研**（RAGFlow / mem0）→ [ragflow-deep-dive](docs/product/ragflow-deep-dive.md) · [mem0-insights](docs/product/mem0-insights.md)

## 为什么选 zleap（对比 RAGFlow）

| 维度 | RAGFlow | **zleap** |
| --- | --- | --- |
| 基础设施 | ES + Redis + MySQL + MinIO 多组件 | **单机零依赖**（SQLite + LanceDB）→ 生产**单 Postgres**（pgvector 一库统一） |
| 核心概念 | 7+ 实体（数据集/助手/Chunk/Memory/Agent…） | **4 个**：信源 · 助手 · 记忆 · 搜索 |
| 记忆 | 独立 Memory 组件，需在画布手动接线（≤5MB） | **本能**：每轮对话自动沉淀—抽取—回灌，越聊越懂你 |
| 溯源 | 引用与原文割裂 | **一步溯源**：引用 → 原文对话框，chunk 级可核查 |
| 检索调参 | 调试面板参数不回填 | **检索测试 → 一键应用到助手**（所见即所得） |
| 防幻觉 | empty response 需配置 | 人格级 `empty_response`，检索为空直接兜底、不外溢 |
| Prompt | 黑盒 | **查看本轮 prompt**：实际提示词摊开可核查 |
| 审计 | 需自建 | **开箱**：关键操作留痕 + CSV 导出 + 请求追踪 |
| 团队 | 组织/项目较重 | 空间=记忆体，个人=1 人、公司=N 人**同一模型**；三档角色 |
| 对外调用 | 专有 API | **OpenAI 兼容端点**：任意助手当作「带记忆与引用的模型」调用 |

> 我们不打 OCR / 模板 / 工作流画布 / 渠道矩阵的军备竞赛——把**知识库该有的骨架做到极致稳、极致清晰**。

## 核心概念（只有四个）

- **信源（Source）** — 装内容的容器。上传文档，zleap 自动解析、分块、向量化、抽取事件与实体。
- **助手（Assistant）** — 绑定若干信源，带人格与边界，带引用地回答；每轮对话沉淀为它的记忆。
- **记忆（Memory）** — 助手的本能，不是要你接线的组件。对话自动入库，参与后续检索。
- **搜索（Search）** — ⌘K 全局唤出，可 `@信源` 锁定范围，命中即可跳原文。

## 团队（个人 ↔ 公司，同一模型）

**空间（Workspace）= 一个共享的记忆体。** 个人就是 1 人空间，公司是 N 人空间，机制完全一致。

- 角色三档：**所有者**（管理成员/空间）· **编辑者**（读写信源、助手、记忆）· **只读**（仅检索与对话）。
- 助手可见性：**私有**（仅创建者）/ **团队**（空间共享，对话沉淀为团队记忆）。
- 共享助手的**会话按人隔离**——团队共享记忆，但各人的对话互不可见。
- 顶栏一键切换空间；设置页管理成员与角色；所有者可查审计并导出。

## 快速开始

### 本地开发（零依赖）

```bash
# 后端
cd apps/api
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # 填入 OpenAI 兼容的 LLM / embedding 配置
uvicorn zleap_api.main:app --reload

# 前端
cd apps/web
npm install
npm run dev                   # http://localhost:3000
```

首个注册用户即成为其空间的所有者。未配置 LLM 也能启动并上传文档，仅抽取/问答需要模型。

### 一键部署（Docker Compose · 单 Postgres）

```bash
cd deploy
cp .env.example .env          # 至少设置 ZLEAP_SECRET_KEY（openssl rand -hex 32）与 LLM 配置
docker compose up -d          # api 就绪探针通过后 web 才启动
```

生产环境若沿用默认密钥会**拒绝启动**——这是有意的防呆。

### 三步上手

1. **建信源**，上传文档 —— 自动解析、分块、抽取。
2. **建助手**，勾选要绑定的信源 —— 立刻可带引用对话。
3. **问它** —— 答案带引用，点引用看原文；对话自动沉淀为记忆。

## 作为「模型」被调用（OpenAI 兼容）

任意助手都暴露一个 OpenAI Chat Completions 端点，检索、人格、防幻觉与站内一致：

```bash
curl -s http://localhost:8000/api/v1/openai/<SOUL_ID>/chat/completions \
  -H "Authorization: Bearer <ZLEAP_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"报销流程是怎样的？"}]}'
```

返回标准 `chat.completion` 结构，额外带 `zleap.citations` 引用字段（标准客户端会忽略未知字段）。`"stream": true` 时以 SSE 分块返回。

## 架构一览

```
apps/web   Next.js + shadcn/ui（纸墨 + 淡金，亮暗双主题，⌘K 全局搜索）
apps/api   FastAPI · services 纯领域 · sag/ 唯一引擎适配层 · jobs 进程内队列（退避重试）
           团队与角色 · 审计留痕 · 引擎槽 LRU · 就绪/存活探针 · OpenAI 端点
zleap-sag  解析 · 分块 · 向量 · 事件—实体图谱 · 检索（只做检索，不做生成）
```

详见 [docs/architecture.md](docs/architecture.md)。

## 许可

见 [LICENSE](LICENSE)。基于 [`zleap-sag`](https://pypi.org/project/zleap-sag/) 引擎构建。
