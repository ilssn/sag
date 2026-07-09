---
name: sag-knowledge
description: Search, browse, and read documents in a sag knowledge base from any AI coding agent — semantic search with citations, document outline, exact grep, and paginated raw reads over MCP (HTTP or stdio).
---

# sag Knowledge Base

sag 把你的文档变成可检索、可溯源的知识库，并以 **MCP** 暴露给任何 Agent。
本 Skill 教会 Agent 使用 sag 信源端点的 7 个工具完成「先看结构、再精确取内容」的探索漏斗。

## 连接

任一信源的连接信息可在 sag 界面「知识库 → 信源详情 → MCP 集成」复制，或：

```bash
curl -s http://<host>/api/v1/sources/<SOURCE_ID>/mcp -H "Authorization: Bearer <TOKEN>"
```

- **HTTP（推荐）**：`http://<host>/mcp/?source_id=<SOURCE_ID>`，Header `Authorization: Bearer <TOKEN>`
- **stdio**：`SAG_MCP_SOURCE_ID=<SOURCE_ID> python -m sag_api.mcp.server`（需 apps/api 环境）

## 工具与用法（漏斗顺序）

| 顺序 | 工具 | 何时用 |
| --- | --- | --- |
| 1 | `list_documents()` | 先了解信源里有什么文档（id/状态/分块数） |
| 2 | `outline(document_id)` | 看目标文档的大纲（heading 序 + chunk_id），定位章节 |
| 3 | `search(query, top_k?)` | 语义召回：自然语言问题 → 带编号证据（含 chunk_id） |
| 4 | `grep(pattern, limit?)` | 精确匹配：专名/编号/代码片段（大小写不敏感） |
| 5 | `get_chunk(chunk_id)` | 读某个分块完整原文（引用溯源终点） |
| 6 | `read(document_id, offset?, limit?)` | 按行分页读原始文件（默认 120 行/页） |
| 7 | `get_entity(name)` | 人物/概念澄清：实体的相关事件上下文 |

**原则**：回答引用 `search` 返回的 `[n]` 编号；不确定时先 `outline`/`grep` 缩小范围再读，
避免整篇 `read` 浪费上下文。详见 references/。

## References

- [references/mcp-tools.md](references/mcp-tools.md) — 各工具参数与返回形态
- [references/search-strategies.md](references/search-strategies.md) — 查询策略与漏斗范式
