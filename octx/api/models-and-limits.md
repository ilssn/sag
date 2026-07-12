# 数据模型与资源限制

`octx` 使用不可变 dataclass 表达创建结果、文档和校验报告。映射字段会转换为只读视图，所有类型都可以从顶层 `octx` 导入。

## `CreateResult`

[`create_octx()`](./create-octx.md) 成功后返回：

| 字段 | 作用 |
| --- | --- |
| `output` | 已发布 `.octx` 的绝对 `Path`。 |
| `workspace` | 生产 workspace 的绝对 `Path`。 |
| `asset_id` | Asset UUIDv7。 |
| `version` | 本次 Release 的 SemVer。 |
| `created_at` | Release 创建时间。 |
| `package_digest` | `sha256:` Package Digest。 |
| `document_ids` | `knowledge/...md` 到 Document UUIDv7 的只读映射。 |
| `report` | 发布前完成的 `ValidationReport`。 |
| `status` | 固定为 `"ready"`。 |

`result.to_dict()` 返回 JSON 可序列化结构。

## `Document`

[`OctxPackage.iter_documents()`](./octx-package.md) 产生：

| 字段 | 作用 |
| --- | --- |
| `path` | Package 内的 Markdown 路径。 |
| `metadata` | 只读 YAML frontmatter 映射。 |
| `body` | 去掉 frontmatter 和可选 UTF-8 BOM 后的 Markdown。 |
| `raw` | manifest 摘要对应的原始字节。 |

## `ValidationReport`

[`validate_octx()`](./validate-octx.md) 返回：

| 字段 | 作用 |
| --- | --- |
| `valid` | OCTX 格式和所有已执行的已知层是否有效。 |
| `fully_validated` | 是否理解并完整验证了全部声明层。 |
| `format` | OCTX 格式的 `LayerResult`。 |
| `capabilities` | Capability 名称到 `LayerResult` 的只读映射。 |
| `profiles` | Profile 名称到 `LayerResult` 的只读映射。 |
| `issues` | 全部 `ValidationIssue`。 |
| `issue_codes` | 报告中错误码的只读集合。 |

`LayerResult` 包含 `declared`、`valid`、`version`、`fully_validated` 和该层的 `issues`。`ValidationIssue` 包含 `code`、`severity`、`message`，以及可选的 `path`、`line`、`record_id`。

## `ArchiveLimits`

所有主要入口都接受 `ArchiveLimits`：

```python
from octx import ArchiveLimits, validate_octx

limits = ArchiveLimits(
    max_entries=2_000,
    max_file_size=64 * 1024 * 1024,
    max_total_uncompressed=256 * 1024 * 1024,
    max_jsonl_line_size=2 * 1024 * 1024,
    max_jsonl_records=100_000,
    max_arrow_batches=10_000,
    max_arrow_rows=1_000_000,
    max_arrow_values=20_000_000,
    max_issues=100,
)

report = validate_octx("upload.octx", limits=limits)
```

可配置字段：

| 字段 | 默认值 | 限制对象 |
| --- | ---: | --- |
| `max_entries` | 10,000 | ZIP 或目录总条目数。 |
| `max_file_size` | 512 MiB | 单文件及 Arrow metadata。 |
| `max_total_uncompressed` | 4 GiB | 总解压大小及 Arrow 解码字节。 |
| `max_compression_ratio` | 200 | 单个 ZIP 条目压缩比。 |
| `max_jsonl_line_size` | 16 MiB | 单条 JSONL 记录字节数。 |
| `max_jsonl_records` | 1,000,000 | 每个 JSONL 文件记录数。 |
| `max_json_depth` | 100 | JSON 嵌套深度。 |
| `max_yaml_depth` | 100 | YAML frontmatter 嵌套深度。 |
| `max_arrow_dimension` | 65,536 | 单条向量维度。 |
| `max_arrow_batches` | 100,000 | Arrow DictionaryBatch 与 RecordBatch 总数。 |
| `max_arrow_rows` | 10,000,000 | Arrow 总行数。 |
| `max_arrow_values` | 100,000,000 | Arrow 向量总标量数。 |
| `max_issues` | 1,000 | 校验报告问题数。 |

所有限制必须为正数。服务端处理上传内容时，应根据可用内存、磁盘和请求预算设置更小的值。
