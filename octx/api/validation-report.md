# `ValidationReport`

`ValidationReport` 是 [`validate_octx()`](./validate-octx.md) 返回的不可变校验报告。普通格式、摘要或结构错误会记录在报告中，不需要调用方解析异常文本。

## 获取对象

```python
from octx import validate_octx

report = validate_octx("product-guide.octx")

if not (report.valid and report.fully_validated):
    for issue in report.issues:
        print(issue.severity, issue.code, issue.path, issue.message)
```

## 字段

| 字段 | 作用 |
| --- | --- |
| `valid` | OCTX 格式和所有已执行的已知层是否有效。 |
| `fully_validated` | 当前安装是否理解并完整验证了全部声明层。 |
| `format` | OCTX 格式的 `LayerResult`。 |
| `capabilities` | Capability 名称到 `LayerResult` 的只读映射。 |
| `issues` | 全部 `ValidationIssue`。 |
| `issue_codes` | 报告中错误码的只读集合。 |

## 相关对象

`LayerResult` 包含 `declared`、`valid`、`version`、`fully_validated` 和该层的 `issues`。

`ValidationIssue` 包含 `code`、`severity`、`message`，以及可选的 `path`、`line`、`record_id`。

发布或高信任导入通常应同时要求 `valid` 和 `fully_validated` 为 `True`。使用 `report.to_dict()` 可以得到 JSON 可序列化结构。
