# `open_octx()`

`open_octx()` 安全打开 `.octx` ZIP/ZIP64 文件或已经展开的 OCTX 目录，并返回只读 [`OctxPackage`](./octx-package.md)。

## 函数签名

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

## 它会做什么

打开阶段会：

- 扫描全部 ZIP 或目录条目，包括 manifest 未列出的条目。
- 拒绝路径穿越、符号链接、加密条目、不支持的压缩方法和 local/central header 差异。
- 限制条目数、单文件大小、总解压大小和压缩比。
- 读取并解析 `manifest.json`，建立只读 payload 视图。

## 它不会做什么

`open_octx()` 当前不会完整校验文件摘要、JSON Schema、Capability、关系覆盖或向量内容，也不会写入源文件。

需要完整校验时调用 [`validate_octx()`](./validate-octx.md)：

```python
from octx import open_octx, validate_octx

with open_octx("asset.octx") as package:
    report = validate_octx(package)
    if not report.valid:
        raise ValueError(report.to_dict())
    print(package.manifest["asset"])
```

## 生命周期

推荐使用 `with`，确保持续打开的文件描述符和 ZIP reader 被关闭：

```python
with open_octx("asset.octx") as package:
    documents = list(package.iter_documents())
```

也可以显式调用 `package.close()`。关闭后继续读取会抛出 `ValueError`。

## 失败方式

容器无法安全打开时会抛出 `OctxOpenError` 的子类，例如：

- `OctxFormatError`：ZIP、manifest 或编码格式损坏。
- `OctxSecurityError`：危险路径、链接、加密或输入在读取期间发生变化。
- `OctxResourceLimitError`：输入超过资源上限。

需要把不可信格式错误转换为报告而不是异常时，直接使用 `validate_octx(path)`。
