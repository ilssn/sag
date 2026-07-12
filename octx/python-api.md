# OCTX Python API

`octx` 是 OCTX 格式的独立 Python 参考实现。它负责创建、打开、校验和安全解包 `.octx` Package，不依赖 SAG、数据库或检索后端。

## 安装

需要 Python 3.11 或更高版本：

```bash
python -m pip install octx
```

读取或校验 Arrow 向量文件时，安装 `vectors` extra：

```bash
python -m pip install "octx[vectors]"
```

## 最小流程

假设 `knowledge/` 中至少有一篇 Markdown：

```text
knowledge/
└── guide.md
```

创建、打开并校验 Package：

```python
from octx import create_octx, open_octx, validate_octx

result = create_octx(
    "./.octx-workspace",
    source="./knowledge",
    name="Product Guide",
    output="./product-guide.octx",
)

with open_octx(result.output) as package:
    for document in package.iter_documents():
        print(document.path, document.metadata["title"])

report = validate_octx(result.output)
assert report.valid
assert report.fully_validated
```

`source` 不会被修改。`workspace` 保存稳定的 Asset、Document 和 Release 身份，后续发布同一资产时应继续使用同一个 workspace。

## `create_octx()`

```python
def create_octx(
    workspace: os.PathLike[str] | str,
    *,
    output: os.PathLike[str] | str,
    source: os.PathLike[str] | str | None = None,
    name: str | None = None,
    version: str | None = None,
    in_place: bool = False,
    confirm_in_place: bool = False,
    derive: bool = False,
    capabilities: Mapping[str, str | Mapping[str, Any]] | None = None,
    profiles: Mapping[str, str | Mapping[str, Any]] | None = None,
    limits: ArchiveLimits | None = None,
) -> CreateResult
```

主要参数：

| 参数 | 含义 |
| --- | --- |
| `workspace` | 可重复使用的 OCTX 工作目录，包含 `knowledge/`、`manifest.json` 和本地状态。 |
| `output` | 要发布的不可变 `.octx` 文件。已有不同内容时不会覆盖。 |
| `source` | 要复制进 workspace 的 Markdown 目录。与 `in_place` 互斥。 |
| `name` | 首次创建 Asset 时必填；后续默认复用已保存的名称。 |
| `version` | Release 的 SemVer；首次默认 `1.0.0`。内容改变时必须提高版本。 |
| `in_place` | 把 workspace 根目录中的 Markdown 整理进 `knowledge/`。 |
| `confirm_in_place` | 明确允许 `in_place` 产生的移动和 frontmatter 补全。 |
| `derive` | 从展开的外部 Package 显式创建新 Asset，并记录 `asset.derived_from`。 |
| `capabilities` | 显式声明能力，例如 `{"chunks": "1.0"}`。不会根据文件自动推断。 |
| `profiles` | 显式声明 Profile，例如 `{"sag-structured": "1.0"}`。 |
| `limits` | 自定义读取和校验资源上限，默认使用 `ArchiveLimits()`。 |

`CreateResult` 提供 `output`、`workspace`、`asset_id`、`version`、`created_at`、`package_digest`、`document_ids`、`report` 和固定为 `ready` 的 `status`。可用 `result.to_dict()` 获得 JSON 可序列化结果。

创建过程会先生成临时包并完整校验，只有通过校验后才会发布到 `output`。同一版本、同一逻辑内容可以稳定重建；同一版本的内容发生变化时会抛出 `ReleaseVersionError`。

展开的外部 Package 默认是只读发布内容。内容未变化时可以无损重新封装为同一 Package，且不会创建本地 producer state。修改或增强后再发布时必须显式派生：

```python
derived = create_octx(
    "./external-expanded",
    derive=True,
    output="./derived.octx",
)
```

派生结果使用新的 `asset_id`，首个 Release 默认从 `1.0.0` 开始，并记录直接来源的 Asset ID、版本和 Package Digest。

无损重新封装会保留当前工具不认识的 manifest 字段。新 Release 或派生 Asset 会重新生成 Core manifest、Release 和文件清单，不会自动继承来源中的未知签名、证明或文件级断言；这些字段需要由理解其语义的生产者重新声明。

### 在现有 workspace 发布新版本

```python
from octx import create_octx

result = create_octx(
    "./.octx-workspace",
    version="1.1.0",
    output="./product-guide-1.1.0.octx",
)
```

### 声明 SAG-structured

声明 Profile 不会替你生成结构化数据。对应 JSONL 和关系文件必须已经存在于 workspace 中并满足完整覆盖约束。

```python
result = create_octx(
    "./.octx-workspace",
    version="2.0.0",
    output="./product-guide-2.0.0.octx",
    capabilities={
        "chunks": "1.0",
        "events": "1.0",
        "entities": "1.0",
    },
    profiles={"sag-structured": "1.0"},
)
```

## `open_octx()`

```python
def open_octx(
    source: os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
) -> OctxPackage
```

`source` 可以是 `.octx` ZIP 文件，也可以是已经展开的 OCTX 工作目录。`open_octx()` 会安全扫描容器、限制资源用量并读取 manifest，但不会执行完整的 Core、Capability 或 Profile 校验，也不会写入源文件。

因此，打开成功不等于 Package 已通过规范校验。处理不可信输入时，应继续调用 `validate_octx()`。

```python
from octx import open_octx, validate_octx

with open_octx("asset.octx") as package:
    report = validate_octx(package)
    if not report.valid:
        raise ValueError(report.to_dict())
    manifest = package.manifest
```

## `OctxPackage` 读取器

`OctxPackage` 是只读视图，也支持 `with` 上下文管理器。调用 `close()` 后不能继续读取。

常用属性：

| 属性 | 类型 | 含义 |
| --- | --- | --- |
| `source` | `Path` | Package 文件或工作目录。 |
| `source_kind` | `str` | `"zip"` 或 `"directory"`。 |
| `manifest` | `dict` | manifest 的独立副本。 |
| `files` | `tuple[str, ...]` | manifest 中声明的 payload 路径。 |
| `available_paths` | `frozenset[str]` | 容器中实际可见的全部安全路径。 |

通用读取方法：

```python
with open_octx("asset.octx") as package:
    raw = package.read_payload("knowledge/guide.md")

    with package.open_payload("knowledge/guide.md") as stream:
        first_bytes = stream.read(128)

    for document in package.iter_documents():
        print(document.path)
        print(document.metadata)
        print(document.body)
```

`open_payload()` 和 `read_payload()` 只允许访问 manifest `files` 中声明的 payload。`Document` 包含 `path`、只读 `metadata`、Markdown `body` 和原始 `raw` 字节。

SAG 结构层读取器：

```python
chunks = package.iter_chunks()
events = package.iter_events()
entities = package.iter_entities()
chunk_events = package.iter_chunk_events()
event_entities = package.iter_event_entities()
```

这些方法逐条产生 JSON object；也可以通过 `iter_jsonl(path)` 读取其他已声明的 JSONL payload。调用前应确认对应 Capability 已声明并通过校验。

向量读取需要安装 `octx[vectors]`：

```python
table = package.read_vector_table("chunks")

for batch in package.iter_vector_batches("events"):
    consume(batch)
```

`target` 只能是 `"chunks"`、`"events"` 或 `"entities"`。

## `validate_octx()`

```python
def validate_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
    max_issues: int | None = None,
) -> ValidationReport
```

可以直接传入文件路径、工作目录或已经打开的 `OctxPackage`。即使容器无法打开，函数也会返回无效报告，而不是把普通格式错误作为控制流抛出。

```python
report = validate_octx("asset.octx")

if not report.valid:
    for issue in report.issues:
        print(issue.severity, issue.code, issue.path, issue.message)
```

`ValidationReport` 的主要字段：

| 字段 | 含义 |
| --- | --- |
| `valid` | Core 有效，且所有已识别的声明层都没有验证失败。 |
| `fully_validated` | 当前实现理解并完整验证了全部声明层。 |
| `core` | OCTX Core 的 `LayerResult`。 |
| `capabilities` | 按名称索引的 Capability 校验结果。 |
| `profiles` | 按名称索引的 Profile 校验结果。 |
| `issues` | 所有 `ValidationIssue`，包含 `code`、`severity`、`message` 及可选位置。 |
| `issue_codes` | 报告内全部问题代码的只读集合。 |

未知的 Capability、未知的 Profile，或未安装 `vectors` extra 时无法完成的 Arrow 校验，会产生 warning，并使 `fully_validated` 为 `False`；只要 Core 和所有已完成校验的已识别层有效，`valid` 仍可为 `True`。发布前应同时检查 `report.valid` 和 `report.fully_validated`。使用 `report.to_dict()` 可生成适合日志或 API 响应的结构化数据。

## `unpack_octx()`

```python
def unpack_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
) -> Path
```

解包前会校验 Core 完整性和当前实现能够验证的声明层，只写入 manifest 和 manifest 声明的 payload。未知层或未安装的可选校验器不会阻止安全解包，但调用方可以先检查 `report.fully_validated` 决定是否接受。目标目录必须不存在或为空；已验证层无效时会抛出 `OctxValidationError`。

```python
from octx import unpack_octx

destination = unpack_octx("asset.octx", "./asset-expanded")
print(destination)
```

不要对不可信 `.octx` 文件直接使用通用 ZIP `extractall()`；应使用 `unpack_octx()`。

## 资源限制

所有入口都接受 `ArchiveLimits`。需要更严格的服务端边界时，可以覆盖默认值：

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
)

report = validate_octx("upload.octx", limits=limits, max_issues=100)
```

`ArchiveLimits` 还可以限制压缩比、JSON/YAML 深度、Arrow 维度和问题数量。Arrow IPC 会先检查消息边界和 schema，再按 record batch 解码；OCTX vectors 1.0 不接受 Arrow body compression。

## CLI

安装包后可直接使用 `octx`：

```bash
# 从 Markdown 目录创建 Package
octx create ./.octx-workspace \
  --from ./knowledge \
  --name "Product Guide" \
  --output ./product-guide.octx

# 只读取摘要，不做完整校验
octx inspect ./product-guide.octx

# 完整校验
octx validate ./product-guide.octx

# 校验通过后安全解包
octx unpack ./product-guide.octx ./product-guide-expanded
```

四个子命令都支持 `--json`。`create` 还支持 `--version`、`--derive`、可重复的 `--capability NAME=VERSION`、可重复的 `--profile NAME=VERSION`，以及互斥的 `--from SOURCE` / `--in-place`。非交互环境使用 `--in-place` 时还要显式传入 `--yes`。

`validate` 在有效时退出 `0`、无效时退出 `1`；命令用法或输入错误退出 `2`。

## 错误处理

公开异常都继承自 `OctxError`。常见边界可以这样处理：

```python
from octx import OctxError, OutputExistsError, ReleaseVersionError

try:
    result = create_octx(...)
except OutputExistsError:
    # output 已经包含另一份不可变 Package
    raise
except ReleaseVersionError:
    # 内容变化后仍沿用了旧版本，或版本发生回退
    raise
except OctxError:
    # 其他 OCTX 格式、完整性、安全或资源限制错误
    raise
```

`validate_octx()` 适合把不可信输入转换为结构化报告；`open_octx()`、`create_octx()` 和 `unpack_octx()` 则会在无法完成操作时抛出异常。
