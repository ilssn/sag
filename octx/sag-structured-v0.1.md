# SAG-structured Capability 0.1

> 状态：v0.1 设计基线。本文定义 OCTX `sag-structured/0.1` Capability 及其完整数据约束。

**第一次接触 SAG？** [先阅读 SAG 介绍](sag.md)，了解 SAG 应用、检索架构和 `zleap-sag` 的区别。

## 1. 目的

`sag-structured` 表示 Package 已显式携带完整、可验证、可直接映射到 SAG 结构层的 `document → chunk → event → entity` 数据。它是一项整体 Capability，不把 chunks、events 和 entities 拆成三个声明，也不是本地索引是否已经 `ready` 的状态。

声明方式：

```json
{
  "capabilities": {
    "sag-structured": {"version": "0.1"}
  }
}
```

vectors 对该 Capability 保持可选；携带向量时再声明 `vectors/0.1`。

## 2. 包含内容

```text
OCTX + sag-structured/0.1
  -> chunks
  -> events
  -> entities
  -> chunk-event relations
  -> event-entity relations

vectors/0.1 -> 依赖 sag-structured/0.1
```

- 五个结构文件必须作为一个整体出现并通过校验。
- chunks、events、entities 和 relations 不再各自声明 Capability。
- `sag-structured` 必须出现在 manifest 中，不能仅根据文件存在情况自动推断。
- `vectors/0.1` 是独立可选 Capability，但只能引用有效的 `sag-structured/0.1` 记录。

## 3. Chunks 0.1

文件：`data/chunks.jsonl`

每行是一个 JSON object：

```json
{
  "id": "019c2222-2222-7222-8222-222222222222",
  "document_id": "019c1234-5678-7abc-8def-0123456789ab",
  "ordinal": 0,
  "text": "第一个 chunk"
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `id` | 是 | 规范小写 UUIDv7，在 Package 中唯一 |
| `document_id` | 是 | 引用一篇有效 Concept Document 的 `octx.document_id` |
| `ordinal` | 是 | 非负整数，表示文档内顺序 |
| `text` | 是 | 非空完整 Chunk 文本，不是摘要或预览 |

同一 `document_id` 内 `ordinal` 必须唯一；允许存在间隔，消费者按数值升序恢复顺序。JSONL 物理行号不表达 Chunk 顺序。

v0.1 使用 `document_id + ordinal` 作为标准来源定位，不同时规定页码、字符偏移或标题路径。额外定位可以作为未知可选字段保存，但不能替代必填字段。

## 4. Events 0.1

文件：

- `data/events.jsonl`
- `relations/chunk-events.jsonl`

Event：

```json
{
  "id": "019c4444-4444-7444-8444-444444444444",
  "title": "过五关斩六将",
  "content": "关羽护送二嫂寻兄途中连续闯关。"
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `id` | 是 | 规范小写 UUIDv7，在 Package 中唯一 |
| `title` | 是 | 非空、可独立展示的 Event 标题 |
| `content` | 是 | 非空、脱离 Chunk 仍可理解的完整 Event 表达 |
| `summary` | 否 | 字符串 |
| `category` | 否 | 字符串，OCTX 不规定词表 |
| `parent_id` | 条件 | 子 Event 必填，引用同文件 Event |
| `level` | 条件 | 子 Event 必填的正整数 |

顶层 Event 同时省略 `parent_id` 和 `level`，按 level 0 处理。子 Event 必须同时提供两者，且 `level = parent.level + 1`。父子关系不得成环。

Event 不内嵌 `chunk_id`、references 或本地 `rank`。所有来源只由 `chunk-events.jsonl` 表达。

Chunk-Event relation：

```json
{
  "chunk_id": "019c2222-2222-7222-8222-222222222222",
  "event_id": "019c4444-4444-7444-8444-444444444444"
}
```

- 两端引用必须存在。
- `(chunk_id, event_id)` 是关系身份，在文件中不得重复。
- 每个 Event 必须至少关联一个 Chunk。
- 一个 Chunk 可以关联一个或多个 Events。
- 没有细粒度分块但需要发布 Events 时，生产者必须创建覆盖整篇文档的真实全文 Chunk。

## 5. Entities 0.1

文件：

- `data/entities.jsonl`
- `relations/event-entities.jsonl`

Entity：

```json
{
  "id": "019c5555-5555-7555-8555-555555555555",
  "name": "关羽",
  "type": "person"
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `id` | 是 | 规范小写 UUIDv7，在 Package 中唯一 |
| `name` | 是 | 非空规范名称 |
| `type` | 是 | 非空字符串，大小写和词表不受 OCTX 限制 |
| `description` | 否 | 字符串 |

`normalized_name`、数据库 `entity_type_id` 和本地索引字段不进入 OCTX。消费者必须保留生产者原始 `type`，可以本地映射，但不能因未知类型拒绝 Package。

Event-Entity relation：

```json
{
  "event_id": "019c4444-4444-7444-8444-444444444444",
  "entity_id": "019c5555-5555-7555-8555-555555555555",
  "weight": 1.0,
  "description": "事件的主要人物"
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `event_id` | 是 | 引用现有 Event |
| `entity_id` | 是 | 引用现有 Entity |
| `weight` | 否 | 有限 JSON number；v0.1 不规定全局量纲或范围 |
| `description` | 否 | 文本关系说明 |

`(event_id, entity_id)` 是关系身份，在文件中不得重复。每个 Entity 必须至少被一个 Event 引用。

## 6. SAG-structured 完整覆盖

`sag-structured/0.1` 要求整条链没有孤立记录：

1. 每篇 Concept Document 至少有一个 Chunk。
2. 每个 Chunk 至少出现在一条 Chunk-Event relation 中。
3. 每个 Event 至少出现在一条 Chunk-Event relation 中。
4. 每个 Event 至少出现在一条 Event-Entity relation 中。
5. 每个 Entity 至少出现在一条 Event-Entity relation 中。

任何一项不满足都会使整个 `sag-structured/0.1` Capability 无效。OCTX 格式本身仍可以保持有效，但不存在可被单独认定有效的 chunks、events 或 entities 子能力。

该 Capability 不接受以下合成回退：

- 把 Document 临时冒充 Chunk。
- 把 Chunk 临时冒充 Event。
- 生成只为通过 schema 而存在的 synthetic record。
- 用上一级文本复制填充缺失层。

缺失层必须通过真实分块或抽取流程生成。

## 7. Vectors 0.1

配置：`vectors/config.json`

```json
{
  "model": "example/embedding-model",
  "revision": "optional-revision"
}
```

- `model` 是必填非空字符串。
- `revision` 是可选非空字符串。
- Package 最多一套配置，所有随包 Arrow 文件共用。
- 不保存 API 地址、密钥、服务端点、距离度量或归一化设置。

标准目标文件：

- `vectors/chunks.arrow`
- `vectors/events.arrow`
- `vectors/entities.arrow`

Package 可以只携带其中一部分目标，但每个出现的目标文件必须完整覆盖对应 JSONL 的全部记录，不能只保存部分向量。

Arrow IPC file 至少包含：

```text
record_id: utf8 non-null
vector: fixed_size_list<float32>[dimension] non-null
```

要求：

- `record_id` 唯一，恰好覆盖目标记录 ID。
- 不得引用不存在的记录。
- `dimension` 是正整数，同一文件一致。
- vector 元素不得为 null、`NaN` 或正负无穷。
- 消费者可以忽略附加列，但附加列不能替代必需列。
- vectors 0.1 不使用 Arrow IPC body compression，避免在资源上限生效前产生不可控的解压分配。

向量参与逐文件摘要和 Package Digest。只重新生成向量也会产生新的 Release；知识和结构未变化时保留原记录 ID。

本地查询模型与 `model + revision` 不兼容时，消费者丢弃随包向量并完整重建对应目标，不得截断、填充或混用。

## 8. 校验失败与重建

标准 JSONL 中任一记录出现以下问题时，整个 `sag-structured/0.1` Capability 无效：

- 缺少必填字段。
- 字段类型或值不符合 schema。
- ID 重复。
- 引用不存在。
- 关系组合重复。
- 层级成环或 level 不一致。

导入器不得静默跳过坏记录。

处理规则：

- OCTX 格式有效、未声明 `sag-structured`：正常安装，可以从 Markdown 在本地生成完整结构。
- OCTX 格式有效、已声明 `sag-structured` 但无效：报告错误；禁止导入原结构层，也不能静默移除声明。只有用户明确选择后，才放弃整套结构并本地重建。
- `vectors/0.1` 无效：保留有效知识与 SAG 结构，只重建对应向量。
- OCTX 格式无效：禁止安装原 Asset。

重建不做单条补丁。SAG 结构中任一层无效时重建整套结构；向量无效时只重建对应目标：

| 无效内容 | 保留 | 重建 |
| --- | --- | --- |
| SAG 结构中任一层 | OCTX 文档 | chunks、events、entities、关系及相关 vectors |
| 某一 vectors 目标 | 全部有效知识与结构 | 该目标向量文件 |

本地重建结果属于 Installation，不会修改或反向证明原 Package 有效。重新传播增强结果时必须创建派生 Asset 和新 Package。

## 9. Capability 与 ready

`sag-structured` 是 Package 的静态、可验证 Capability；`ready` 是某个消费者本地 Installation 的运行状态。

- 有效 sag-structured Package 可能因为向量不兼容而仍需本地 indexing。
- 仅含 OCTX 文档的 Package 可以在本地补建完成后进入 ready，但原 Package 不因此变成 sag-structured。
- Agent 检索只能在当前 Installation 所需索引实际 ready 后启用。

## 10. 导出

`zleap-sag export_octx()` 默认只在完整覆盖约束全部满足时写入结构层，并在 `capabilities` 中声明 `sag-structured/0.1`。

- 半成品结构层不得进入 Package。
- 用户可以显式 `documents_only=True` 只导出 Markdown。
- vectors 可选，但实际写入的每个目标必须完整。
- 导入后本地增强的内容重新导出时，必须创建带 `asset.derived_from` 的新 Asset。
