# `validate_octx()`

`validate_octx()` 完整校验 OCTX 格式和当前实现认识的 Capability，并返回 [`ValidationReport`](./validation-report.md)。它是处理外部或不可信 Package 的校验入口。

## 函数签名

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
| `limits` | 本次打开和校验使用的 [`ArchiveLimits`](./archive-limits.md)。传入不同限制时会重新打开源。 |
| `max_issues` | 报告中最多保留的问题数，必须为正数。 |

## 基本用法

```python
from octx import validate_octx

report = validate_octx("asset.octx")

if not report.valid:
    for issue in report.issues:
        print(issue.severity, issue.code, issue.path, issue.message)
```

对普通容器、格式和规范错误，函数返回 `valid=False` 的报告，而不是让调用流程因异常中断。

## `valid` 与 `fully_validated`

- `report.valid`：OCTX 格式有效，并且所有已识别且已执行的声明层都没有失败。
- `report.fully_validated`：当前安装理解并完整验证了全部声明层。

因此，一个带未知可选 Capability 的 Package 可以是 `valid=True`、`fully_validated=False`。发布或高信任导入通常应同时要求两者为 `True`：

```python
if not (report.valid and report.fully_validated):
    reject(report.to_dict())
```

没有安装 `octx[vectors]` 时，vectors 层会产生 warning，并使 `fully_validated=False`，但不会伪装成已经验证通过。

## 校验范围

OCTX 格式校验包括容器安全、manifest Schema、身份、版本、文件清单、逐文件 SHA-256、Package Digest、Markdown/OKF frontmatter 和 Document ID。

声明结构层后，还会校验：

- `sag-structured` 中 chunks、events、entities 的 JSON Schema 与 UUIDv7。
- chunk-event、event-entity 引用及层级关系。
- SAG-Structured 的完整覆盖约束。
- Arrow schema、RecordBatch、维度、数值类型、目标覆盖和资源边界。

完整性失败时，不会继续解析对应的不可信结构 payload。

## 已打开 Package 的所有权

```python
from octx import open_octx, validate_octx

with open_octx("asset.octx") as package:
    report = validate_octx(package)
    # package 仍由调用方持有，可继续读取。
```

传入路径时，`validate_octx()` 自己打开并关闭 Package。传入已有 `OctxPackage` 且不覆盖 limits 时，不会替调用方关闭它。

使用 `report.to_dict()` 可以得到适合日志、CLI 或 API 响应的 JSON 可序列化结构。
