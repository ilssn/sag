# 打开与校验

> 状态：v0.1 设计基线。本文说明 OCTX 的安全读取、完整校验和结构化错误报告。

## `open_octx()`

```python
package = open_octx(source)
```

职责：

- 打开 `.octx` 或 OCTX Working Directory。
- 执行容器、路径和基础资源安全检查。
- 解析 manifest。
- 返回只读 Package Reader。
- 流式遍历 Documents、JSONL records、relations 和 vectors。

`open_octx()` 不写数据库，也不表示所有 schema、摘要和关系已经通过完整校验。完整接口见 [`open_octx()` API](api/open-octx.md)。

## `validate_octx()`

```python
report = validate_octx(package_or_source)
```

职责：

- 校验 OCTX 格式与版本。
- 校验规范路径、文件清单和逐文件 SHA-256。
- 重新计算 Package Digest。
- 校验 JSON Schema 与 Arrow schema。
- 校验 ID 唯一性、引用、关系和层级。
- 分别给出 OCTX 格式和 Capabilities 的有效性。
- 生成结构化问题列表。

任何 import 实现都必须在自身事务中确保验证成功，不能相信调用方之前运行过 validate。完整接口见 [`打开与校验 API`](api/open-octx.md)。

## 错误报告

普通 schema 与关系问题尽量一次返回。每项至少包含：

```json
{
  "code": "OCTX_EVENT_MISSING_CONTENT",
  "severity": "error",
  "path": "data/events.jsonl",
  "line": 18,
  "record_id": "optional-uuid",
  "message": "event.content is required"
}
```

`line` 和 `record_id` 只在适用时出现。实现可以设置普通错误数量上限。

以下问题立即停止读取相关可疑内容：

- 路径穿越或目标逃逸。
- 链接、特殊文件或加密条目。
- 条目数量、大小或压缩比超限。
- 文件摘要或 Package Digest 失配。

完整性错误不能被用户确认绕过。
