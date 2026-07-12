# 错误处理

除普通 `OSError`、`ValueError` 和 `FileExistsError` 边界外，公开 OCTX 异常都继承 `OctxError`，并提供稳定的 `code`。多数异常还带可选 `path`。

## 异常层级

| 异常 | 默认错误码 | 何时出现 |
| --- | --- | --- |
| `OctxError` | `OCTX_ERROR` | 所有 OCTX 操作异常的基类。 |
| `OctxOpenError` | `OCTX_OPEN_ERROR` | Package 无法打开的基类。 |
| `OctxFormatError` | `OCTX_FORMAT_ERROR` | ZIP、manifest、JSON、编码或 payload 格式损坏；具体实例可能使用更细错误码。 |
| `OctxSecurityError` | `OCTX_SECURITY_ERROR` | 危险路径、链接、加密条目、源替换或其他安全违规。 |
| `OctxResourceLimitError` | `OCTX_RESOURCE_LIMIT` | 输入超过 `ArchiveLimits`。 |
| `OctxIntegrityError` | `OCTX_INTEGRITY_ERROR` | 完整性操作失败。 |
| `OctxValidationError` | `OCTX_VALIDATION_ERROR` | 创建或解包要求有效 Package，但完整校验失败。 |
| `ReleaseVersionError` | `OCTX_RELEASE_VERSION_REQUIRED` | 内容变化后沿用旧版本，或新版本没有向前移动。 |
| `DerivationRequired` | `OCTX_DERIVATION_REQUIRED` | 修改外部 Package，却没有显式创建派生 Asset。 |
| `OutputExistsError` | `OCTX_OUTPUT_EXISTS` | 输出路径已经存在另一份不可变 Package。 |

## 推荐处理方式

```python
from octx import (
    OctxError,
    OutputExistsError,
    ReleaseVersionError,
    create_octx,
)

try:
    result = create_octx(...)
except OutputExistsError:
    # 不覆盖已经存在的另一份不可变 Package。
    raise
except ReleaseVersionError:
    # 提高 Release 版本后重试。
    raise
except OctxError as error:
    log(error.code, error.path, str(error))
    raise
```

`OctxValidationError.report` 保存完整 [`ValidationReport`](./validation-report.md)：

```python
from octx import OctxValidationError, unpack_octx

try:
    unpack_octx("asset.octx", "./expanded")
except OctxValidationError as error:
    print(error.report.to_dict())
```

## 校验不是异常流

处理不可信输入时，优先直接调用 [`validate_octx()`](./validate-octx.md)。普通 ZIP、格式、摘要和结构错误会转换为 `valid=False` 的报告：

```python
report = validate_octx("upload.octx")
if not report.valid:
    return {"accepted": False, "validation": report.to_dict()}
```

只有参数本身不合法，例如 `max_issues <= 0`，才会继续抛出 `ValueError`。
