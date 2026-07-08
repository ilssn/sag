# 连接器框架

> 目标：**统一标准接入**，让「上下文源源不断地写入」。文档上传只是最朴素的一种；消息、会话、录音、第三方系统都走同一套。现有 `Connector` 抽象 + 注册表 + `file_upload`/`web` 已落地本框架的静态与动态(pull)两态。

## 三种接入形态

| 形态 | 触发 | 例子 | 协议方法 |
|---|---|---|---|
| **静态 Static** | 用户上传 | 文件上传 | —（直接登记文档） |
| **动态 Pull** | 周期 / 手动同步 | Web、Notion、S3、飞书文档 | `discover()` + `fetch()` |
| **流式 Push** | 外部持续推送 | IM 消息、录音流、Webhook | `write()` + 统一 Ingestion API |

三者最终都汇入同一管线：**采集 → 归一为「可 ingest 的条目」→ 缓冲/成块 → `process_document`（ingest+extract）→ 可检索上下文**。

## 统一协议（在现有 `Connector` 上扩展）

```python
class Connector(ABC):
    meta: ConnectorMeta          # kind, title, supports_sync, supports_stream, config_fields

    def validate_config(cfg): ...
    # 动态 pull
    async def discover(cfg) -> list[DiscoveredDoc]: ...
    async def fetch(cfg, doc) -> LocalFile: ...
    # 流式 push（新增）
    def parse_batch(cfg, payload) -> list[IngestItem]: ...   # 把外部载荷解析为归一条目
    # 可选：增量游标
    def cursor(cfg) -> str | None: ...                       # 存于 source.config.cursor
```

`IngestItem`（归一后的最小单元）：
```python
IngestItem(kind="text|file", title, text|path, author?, ts?, thread?, meta{})
```

## 统一 Ingestion API（持续写入）

外部系统无需了解 sag 内部，按标准格式往信源推：

```
POST /v1/sources/{id}/messages     # 消息流（IM/飞书/自定义）
POST /v1/sources/{id}/ingest       # 通用文本/文件条目
```

**标准消息格式**（`message` 信源）：
```json
{ "messages": [
  { "author": "张三", "role": "user", "text": "明天评审几点？",
    "ts": "2026-07-07T09:00:00Z", "thread": "T-102",
    "meta": { "channel": "研发群", "source_msg_id": "m-9" } }
]}
```

**缓冲与成块**：消息按 `thread` + 时间窗/条数聚合成「会话片段」，达到阈值或空闲超时后 flush 成一个 ingest 条目 → 入队处理。既保证实时写入，又给引擎合适的切分粒度。策略可配（窗口大小、最大条数、空闲超时）。

## 信源类型 × 采集策略

| source_type | 采集 | 切分要点 |
|---|---|---|
| `document` | 上传 / 抓取 | 交给 SAG 的 markdown/text 切块 |
| `web` | pull discover+fetch → markdown | 同 document |
| `message` | push /messages → 缓冲成块 | 按 thread + 时间窗聚合，保留 author/ts |
| `conversation` | 灵魂对话自动写入 | 一轮问答为一条；保留引用 |
| `audio` | 上传/流 → 转写(ASR) → 文本 | 转写后 document 化；保留时间戳/说话人 |

> ASR 转写作为一个**前置处理器**（可插拔：本地 whisper / 云 ASR），产出带说话人和时间戳的文本，再走通用管线。

## 安全（连接器是攻击面）

- 出站抓取：仅 http/https、超时、大小上限、可选私网地址阻断（防 SSRF，生产开启）。
- 凭证：连接器的 token/key 存于加密的 `source.config`，**不下发前端**；前端只见非敏感字段。
- 写入接口：每个信源一个**作用域化的 ingest 令牌**，可吊销、可限流；写入行为进审计。

## 连接器路线

已有：`file_upload` · `web`。
下一批：`message_api`（统一写入）· `notion` · `feishu`（文档+消息）· `audio`（上传转写）。
再拓展：`slack` · `s3` · `confluence` · `gmail`…

新增一个连接器 = 实现协议 + 注册 + 声明 `config_fields`（前端表单自动渲染，已实现）。**上层零改动**——这是「标准接入、可拓展」的兑现。
