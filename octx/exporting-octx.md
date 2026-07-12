# 导出与配置

> 状态：v0.1 设计基线。本文以 SAG 为例说明如何导出 `.octx`，以及哪些本地配置不得进入 Package。

## 从 SAG 导出 OCTX

```python
result = export_octx(source_or_asset, output, version=...)
```

默认行为：

- 本地创建工作资产沿用其 `asset_id`。
- 只有 chunks、events、entities 和两层关系完整时才导出结构并声明 `sag-structured`。
- 结构半成品不进入 Package。
- 每个导出的向量目标必须完整；不完整目标省略。
- `documents_only=True` 可以只导出 Markdown。

导入 Package 后生成的本地增强数据如果需要重新传播，必须先创建新的 Derived Asset，并记录：

```json
{
  "asset_id": "source-asset-uuid",
  "version": "source-version",
  "package_digest": "sha256:source-digest"
}
```

外部导入资产始终保持只读、可验证和可升级。

## 本地配置边界

以下信息属于 Installation 或产品本地状态，不写回 OCTX Package：

- SAG Source ID 和数据库主键。
- Agent 绑定、收藏、权限和本地标签。
- 向量数据库、索引参数、距离度量和归一化策略。
- API 地址、密钥和供应商连接配置。
- 本地实体对齐和检索缓存。
- indexing / ready / degraded 状态。

Package 只保存可交换资产事实与明确声明的派生 payload。
