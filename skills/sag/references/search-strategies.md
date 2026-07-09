# 查询策略

## 漏斗范式（省 token、准定位）
1. `list_documents` → 锁定候选文档
2. `outline(doc)` → 找目标章节的 chunk_id
3. `get_chunk(chunk_id)` → 只取需要的分块
4. 拿不准位置 → `search`（语义）或 `grep`（精确）先召回，再 get_chunk

## 何时 search vs grep
- **search**：问句、概念、模糊表述（“报销的审批链是怎样的”）
- **grep**：确定字符串——编号（INV-2024）、函数名、专有名词的精确出现位置

## 引用纪律
回答中的每个事实标注 `[n]`（对应 search 结果编号）；被追问出处时用 get_chunk 展示原文。

## 分页读大文件
`read` 从 offset=1 开始，按返回的「共 N 行」决定翻页；永远不要一次 read 整个大文件。
