# `OctxPackage`

`OctxPackage` 是 `open_octx()` 返回的只读 Package 视图。它隐藏 ZIP 与展开目录的差异，为 manifest、Markdown、结构化 JSONL 和 Arrow 向量提供统一读取接口。

## 基本属性

| 属性 | 类型 | 作用 |
| --- | --- | --- |
| `source` | `Path` | Package 文件或工作目录的绝对路径。 |
| `source_kind` | `str` | `"zip"` 或 `"directory"`。 |
| `manifest` | `dict` | manifest 的独立副本，修改它不会改变 Package。 |
| `files` | `tuple[str, ...]` | `manifest.files` 中声明的 payload 路径。 |
| `available_paths` | `frozenset[str]` | 容器中实际存在的全部安全路径，包括未列普通文件。 |

## 读取原始 payload

```python
with open_octx("asset.octx") as package:
    raw = package.read_payload("knowledge/guide.md")

    with package.open_payload("knowledge/guide.md") as stream:
        first_bytes = stream.read(128)
```

`read_payload()` 和 `open_payload()` 只允许读取 `manifest.files` 中声明的 payload。未列普通文件即使出现在 `available_paths`，也不能通过这些方法读取。

## 读取 Markdown 文档

```python
with open_octx("asset.octx") as package:
    for document in package.iter_documents():
        print(document.path)
        print(document.metadata)
        print(document.body)
```

每个 [`Document`](./document.md) 包含路径、只读 frontmatter、去除 frontmatter 后的 Markdown body 和原始字节。

## 读取结构化数据

标准 SAG 数据使用逐条迭代器，避免一次把大型 JSONL 文件载入内存：

```python
chunks = package.iter_chunks()
events = package.iter_events()
entities = package.iter_entities()
chunk_events = package.iter_chunk_events()
event_entities = package.iter_event_entities()
```

也可以通过 `iter_jsonl(path)` 读取其他已声明 JSONL。调用前应确认对应 Capability 已声明且 [`validate_octx()`](./open-octx.md) 已验证通过。

## 读取向量

向量方法需要安装 `octx[vectors]`：

```python
table = package.read_vector_table("chunks")

for batch in package.iter_vector_batches("events"):
    consume(batch)
```

`target` 只能是 `"chunks"`、`"events"` 或 `"entities"`。大型数据优先使用 `iter_vector_batches()`；它按 RecordBatch 读取，并持续执行行数、值数量和解码字节限制。

## 读取期间的安全检查

Package 打开后会保留源文件或目录身份。每次读取都会确认源没有被替换或修改；ZIP CRC、DEFLATE 损坏和超限读取会转换为稳定的 OCTX 错误。

`OctxPackage` 不是线程间共享的数据库连接，也不缓存业务对象。完成读取后应退出 `with` 或调用 `close()`。
