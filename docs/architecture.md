# muse 架构

## 定位

muse = **产品层**（多用户 / 多信源 / 处理编排 / 答案生成 / UI）覆盖在 `zleap-sag`（**引擎层**：解析·分块·向量·事件-实体图谱·检索）之上。

> 关键分工：**引擎只做检索**（`search` → 排序段落），**不做答案生成**。muse 自持「检索结果 → LLM 流式合成 → 引用」。

## 分层（后端 `apps/api/muse_api`）

```
api/v1/        HTTP 路由：仅 IO / 校验 / 序列化
services/      领域逻辑：auth / sources / documents / chat（不依赖 FastAPI）
jobs/          后台任务：队列抽象 + 进程内 worker + 处理器（ingest→extract 状态机）
generation/    答案合成：OpenAI 兼容客户端 + 提示词 + 引用
sag/       ★  引擎适配层：全项目唯一 import zleap-sag 之处
connectors/ ★  采集抽象 + 注册表（文件上传 → 动态同步）
db/            SQLAlchemy 2.0 模型（异步）
core/          config / security(JWT) / db / deps / errors / logging
```

三个**可拓展性支点**（对应「解耦 / 好拓展」目标）：

1. **SAG 适配层** `sag/engine_manager.py`
   `EngineManager` 按 `source_config_id` 懒构造并缓存 `DataEngine`（引擎「一实例一源」），每源一把锁串行化读写；把 muse 配置装配成 `EngineConfig`，把 `SearchResult.sections` 映射成 muse DTO，把 `SagError` 家族翻译成 muse 领域异常。**替换引擎只改这一层。**

2. **连接器注册表** `connectors/`
   `Connector` 抽象（`validate / discover / fetch`）+ `registry`。当前内置 `FileUploadConnector`（静态）；新增动态连接器（Web / Notion / S3…）= 实现同接口 + 注册，上层零改动。

3. **任务队列抽象** `jobs/`
   `JobQueue` 接口 + `InProcessAsyncQueue`（asyncio，随 API 进程起停，启动时恢复残留任务）。可平滑替换为 Celery / RQ / Arq。

## 核心概念映射

| muse | 引擎 |
|---|---|
| 信源 Source | 一个 `source_config_id`（1:1） |
| 文档 Document | `DataEngine.ingest` + `extract` 的输入 |
| 问答检索 | `DataEngine.search(strategy, top_k)` |

多用户：`User → Membership → Workspace → Source`；密钥不下发前端。

## 请求流

**上传 → 处理**
```
POST /sources/{id}/documents
  → 落盘 + 建 Document(pending) + 建 Job(queued) + 入队
worker: Job(running) → EngineManager.process_document
  on_stage: Document loading → extracting
  → ingest（解析·分块·向量） → extract（事件/实体，失败可降级为 0 事件）
  → Document(ready, chunk/event 计数) ；Source 计数原子累加
```

**问答（流式）**
```
POST /sources/{id}/threads/{tid}/ask  (SSE)
  prepare: 落库用户消息 → EngineManager.search → 段落 + 引用 → 组装提示词
  stream : event=meta(引用) → event=token* → event=done(message_id)
  持久化助手消息用独立会话（规避请求级会话在流式期间关闭）
```

## 存储（渐进式）

- **本地 dev（零依赖）**：muse 元数据 SQLite + 引擎 LanceDB/SQLite（落 `data_dir`）。
- **compose 生产**：单个 Postgres —— muse 元数据 + 引擎 `pgvector`（`relational=postgres`）。仅改环境变量，代码不变。

## 错误映射

`SagError` → muse 领域异常 → HTTP：`Retryable→503`、`NonRetryable/校验→4xx`、`Config→400`、其余→`5xx`；统一响应体 `{"error":{code,message}}`。

## 前端（`apps/web`）

Next.js 15 App Router + shadcn/ui + Tailwind。设计系统「纸墨极简 + 淡金」（`app/globals.css` 令牌，亮暗双主题）。鉴权：JWT 存 cookie + 中间件守卫 + API 客户端加 Bearer。问答用 **SSE-over-fetch**（`lib/sse.ts`，因 ask 是带鉴权的 POST，原生 EventSource 不适用）。

## 如何新增一个连接器（拓展示例）

```python
# muse_api/connectors/web.py
class WebConnector(Connector):
    meta = ConnectorMeta(kind=ConnectorKind.WEB, title="网页", description="...",
                         supports_sync=True, config_fields=[ConfigField("url","起始 URL",required=True)])
    async def discover(self, config): ...   # 列举页面
    async def fetch(self, config, doc): ...  # 抓取为本地文件
# 在 enums.ConnectorKind 增加 WEB；registry.register(WebConnector())
# sync_source 任务即可周期性 discover→fetch→ingest，UI 自动出现该连接器
```
