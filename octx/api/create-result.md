# `CreateResult`

`CreateResult` 是 [`create_octx()`](./create-octx.md) 成功后返回的不可变结果对象。它集中提供已发布 Package 的路径、身份、版本、摘要和校验报告。

## 获取对象

```python
from octx import create_octx

result = create_octx(
    "./.octx-workspace",
    source="./knowledge",
    name="Product Guide",
    output="./product-guide.octx",
)
```

只有 Package 完整构建、校验并发布成功后才会返回 `CreateResult`。

## 字段

| 字段 | 作用 |
| --- | --- |
| `output` | 已发布 `.octx` 的绝对 `Path`。 |
| `workspace` | 生产 workspace 的绝对 `Path`。 |
| `asset_id` | Asset UUIDv7。 |
| `version` | 本次 Release 的 SemVer。 |
| `created_at` | Release 创建时间。 |
| `package_digest` | `sha256:` Package Digest。 |
| `document_ids` | `knowledge/...md` 到 Document UUIDv7 的只读映射。 |
| `report` | 发布前完成的 [`ValidationReport`](./validation-report.md)。 |
| `status` | 固定为 `"ready"`。 |

## 序列化

`result.to_dict()` 返回 JSON 可序列化结构，适合 CLI、日志或 API 响应：

```python
payload = result.to_dict()
print(payload["asset_id"], payload["package_digest"])
```
