# 打开与校验

`open_octx()` 和 `validate_octx()` 是同一读取流程的两个阶段：前者安全打开 Package 并返回只读 [`OctxPackage`](./octx-package.md)，后者完成规范校验并返回 [`ValidationReport`](./validation-report.md)。

这两个函数的文档放在一起，因为处理外部 OCTX 时通常会连续使用它们。Python API 仍保留两个函数，因为它们返回不同对象，调用方也可以只执行需要的阶段。

## 推荐流程

处理外部或不可信 Package 时，先校验，再打开读取：

```python
from octx import open_octx, validate_octx

report = validate_octx("asset.octx")
if not (report.valid and report.fully_validated):
    raise ValueError(report.to_dict())

with open_octx("asset.octx") as package:
    for document in package.iter_documents():
        print(document.path, document.metadata["title"])
```

`open_octx()` 成功只表示容器可以安全打开，不表示 Package 已经通过完整的 OCTX 规范校验。

## `open_octx()`

安全打开 `.octx` ZIP/ZIP64 文件或已经展开的 OCTX 目录，并返回只读 `OctxPackage`。

### 函数签名

```python
def open_octx(
    source: os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
) -> OctxPackage
```

| 参数 | 作用 |
| --- | --- |
| `source` | `.octx` 文件或展开目录。符号链接、特殊文件和危险归档路径会被拒绝。 |
| `limits` | 容器扫描和后续读取使用的 [`ArchiveLimits`](./archive-limits.md)。 |

### 打开阶段会做什么

- 扫描全部 ZIP 或目录条目，包括 manifest 未列出的条目。
- 拒绝路径穿越、符号链接、加密条目、不支持的压缩方法和 local/central header 差异。
- 限制条目数、单文件大小、总解压大小和压缩比。
- 读取并解析 `manifest.json`，建立只读 payload 视图。

它不会完整校验文件摘要、JSON Schema、Capability、关系覆盖或向量内容，也不会写入源文件。

### 生命周期

推荐使用 `with`，确保持续打开的文件描述符和 ZIP reader 被关闭：

```python
with open_octx("asset.octx") as package:
    documents = list(package.iter_documents())
```

也可以显式调用 `package.close()`。关闭后继续读取会抛出 `ValueError`。

### 失败方式

容器无法安全打开时会抛出 `OctxOpenError` 的子类，例如：

- `OctxFormatError`：ZIP、manifest 或编码格式损坏。
- `OctxSecurityError`：危险路径、链接、加密或输入在读取期间发生变化。
- `OctxResourceLimitError`：输入超过资源上限。

需要把不可信格式错误转换为报告而不是异常时，直接使用 `validate_octx(path)`。

## `validate_octx()`

完整校验 OCTX 格式和当前实现认识的 Capability，并返回 `ValidationReport`。它是处理外部或不可信 Package 的首选入口。

### 函数签名

```python
def validate_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
    max_issues: int | None = None,
) -> ValidationReport
```

| 参数 | 作用 |
| --- | --- |
| `package_or_source` | `.octx` 路径、展开目录或已经打开的 `OctxPackage`。 |
| `limits` | 本次打开和校验使用的资源上限。传入不同限制时会重新打开源。 |
| `max_issues` | 报告中最多保留的问题数，必须为正数。 |

### 基本用法

```python
from octx import validate_octx

report = validate_octx("asset.octx")

if not report.valid:
    for issue in report.issues:
        print(issue.severity, issue.code, issue.path, issue.message)
```

对普通容器、格式和规范错误，函数返回 `valid=False` 的报告，而不是让调用流程因异常中断。

### `valid` 与 `fully_validated`

- `report.valid`：OCTX 格式有效，并且所有已识别且已执行的声明层都没有失败。
- `report.fully_validated`：当前安装理解并完整验证了全部声明层。

因此，一个带未知可选 Capability 的 Package 可以是 `valid=True`、`fully_validated=False`。发布或高信任导入通常应同时要求两者为 `True`。

没有安装 `octx[vectors]` 时，vectors 层会产生 warning，并使 `fully_validated=False`，但不会伪装成已经验证通过。

### 校验范围

OCTX 格式校验包括容器安全、manifest Schema、身份、版本、文件清单、逐文件 SHA-256、Package Digest、Markdown/OKF frontmatter 和 Document ID。

声明结构层后，还会校验：

- `sag-structured` 中 chunks、events、entities 的 JSON Schema 与 UUIDv7。
- chunk-event、event-entity 引用及层级关系。
- SAG-structured 的完整覆盖约束。
- Arrow schema、RecordBatch、维度、数值类型、目标覆盖和资源边界。

完整性失败时，不会继续解析对应的不可信结构 payload。

### 已打开 Package 的所有权

```python
with open_octx("asset.octx") as package:
    report = validate_octx(package)
    # package 仍由调用方持有，可继续读取。
```

传入路径时，`validate_octx()` 自己打开并关闭 Package。传入已有 `OctxPackage` 且不覆盖 limits 时，不会替调用方关闭它。

使用 `report.to_dict()` 可以得到适合日志、CLI 或 API 响应的 JSON 可序列化结构。
