# `unpack_octx()`

`unpack_octx()` 在校验通过后，将 OCTX manifest 和全部已声明 payload 安全展开到目标目录。它是通用 ZIP `extractall()` 的 OCTX 替代入口。

## 函数签名

```python
def unpack_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
) -> Path
```

| 参数 | 作用 |
| --- | --- |
| `package_or_source` | `.octx` 路径、展开目录或已打开的 `OctxPackage`。 |
| `destination` | 目标目录；必须不存在或为空，且不能是文件系统根目录。 |
| `limits` | 打开、校验和复制期间的 [`ArchiveLimits`](./archive-limits.md)。 |

## 基本用法

```python
from octx import unpack_octx

destination = unpack_octx(
    "./product-guide.octx",
    "./product-guide-expanded",
)
print(destination)
```

## 安全与原子性

解包流程会：

1. 调用 [`validate_octx()`](./validate-octx.md)，拒绝无效 OCTX Package 或已知无效层。
2. 检查目标路径的符号链接、平台路径别名和大小写碰撞。
3. 只复制 `manifest.json` 和 `manifest.files` 声明的 payload。
4. 复制过程中重新计算每个 payload 的 SHA-256，防止校验后源发生变化。
5. 先写临时目录，全部成功后再原子发布目标目录。

安全但未列入 manifest 的普通归档文件不会被展开。未知可选层或缺少可选 validator 时，Package 可能 `valid=True`、`fully_validated=False`；调用方可以先检查报告并制定更严格的接收策略。

## 失败方式

- Package 无效：抛出 `OctxValidationError`，其中 `error.report` 包含完整问题。
- 目标目录非空或已被其他内容占用：抛出 `FileExistsError`。
- 目标路径不安全或源在复制期间变化：抛出 `OctxSecurityError`。

传入已经打开的 `OctxPackage` 时，函数不会关闭调用方持有的对象；传入路径时会自行打开并关闭。
