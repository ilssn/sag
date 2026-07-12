# `ArchiveLimits`

`ArchiveLimits` 定义 OCTX 创建、打开、校验和安全解包时允许使用的资源预算。所有主要入口都接受这个不可变配置对象。

## 基本用法

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

同一个对象可以传给 [`create_octx()`](./create-octx.md)、[`open_octx()` 与 `validate_octx()`](./open-octx.md)，以及 [`unpack_octx()`](./unpack-octx.md)。

## 可配置字段

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

## 使用原则

所有限制必须为正数。服务端处理上传内容时，应根据可用内存、磁盘和请求预算设置更小的值；不要直接把默认值理解为业务系统必须接受的规模。
