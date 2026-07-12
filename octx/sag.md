# SAG 是什么？

SAG 是一套面向个人与 Agent 的开源知识库应用，也是一套同名的原创检索架构。OCTX 兼容 SAG 的 Chunk-Event-Entity 超图数据结构，并通过可选的 SAG-structured Capability 携带这些数据；创建、传播或使用 OCTX 都不强制依赖 SAG。

**为什么兼容 SAG？** SAG 通过 Event-Entity 索引和查询时动态超边，在一条检索管线中同时具备传统 RAG 的语义召回优势与 GraphRAG 的关系推理优势，而不需要维护并拼接两套系统。[SAG 论文](https://arxiv.org/abs/2606.15971)在 HotpotQA、2WikiMultiHopQA 和 MuSiQue 的 9 项 Recall@1/2/5 指标中取得 8 项最佳结果，是这组公开多跳 RAG 基准中整体表现领先的方案。

## 一句话理解

SAG 把分散的文档和数据处理成可搜索、可关联、可追溯的知识：

```text
信源与文档
  → 解析、分块与结构化抽取
  → Chunk、Event、Entity 与关系
  → 检索、原文溯源与带引用的 Agent 回答
  → 通过 API、MCP 或 OCTX 复用
```

## 三个容易混淆的名字

| 名称 | 是什么 | 与 OCTX 的关系 |
| --- | --- | --- |
| **SAG 应用** | 用户直接使用的完整知识库应用，负责知识导入、组织、检索、溯源和 Agent 问答。 | 可以创建、导入和使用 `.octx` Package。 |
| **SAG 检索架构** | 基于 Event-Entity 索引与查询时动态超边的原创检索方法。它在一条检索管线中同时提供语义检索与关系推理，不是传统 RAG 与 GraphRAG 的拼接。 | 定义 SAG 如何生成和检索 Chunk、Event、Entity 结构，但不是 OCTX 的使用前提。 |
| **`zleap-sag`** | 实现 SAG 检索架构的 Python 引擎，提供抽取、检索，以及 `.octx` 与 SAG 之间的导入和导出适配。 | 依赖通用 `octx` 包，并增加 `import_octx()` 与 `export_octx()`。 |

## SAG 如何处理知识

1. 导入文件或网页等信源，并将文档解析为可追溯的原文块。
2. 从原文块中抽取语义完整的 Events 和用于索引、扩展的 Entities。
3. 保存 Chunk、Event、Entity 及其关系，同时建立向量和全文索引。
4. 查询时先找到相关事件与实体，再通过共享实体构造当前问题需要的局部关联。
5. 最终返回原始 Chunk 作为证据，让检索结果和 Agent 回答都能回到原文。

SAG 的论文题为 **SAG: SQL-Retrieval Augmented Generation with Query-Time Dynamic Hyperedges**。完整方法见 [SAG 论文](https://arxiv.org/abs/2606.15971)。

## SAG 为什么出现在 Open Context 文档中

SAG 会产生文档、Chunks、Events、Entities、关系和向量。过去，这些结果通常只保存在 SAG 自己的数据库和索引中；Open Context 把它们封装成可传播、可校验的资产。

两者的边界是：

- **SAG** 负责生成、检索和使用知识。
- **OCTX** 负责描述、封装和验证可传播的上下文。
- **SAG-structured Capability** 负责声明一个 OCTX Package 已携带完整、可直接导入 SAG 结构层的数据。

因此，SAG 可以生产和消费 OCTX，但不是 OCTX 的必要组成部分。其他知识系统也可以直接采用 OCTX，并实现自己的导入、导出和检索适配。

## 相关入口

- [SAG 开源项目](https://github.com/Zleap-AI/SAG)
- [SAG 论文](https://arxiv.org/abs/2606.15971)
- [SAG-structured Capability](sag-structured-v0.1.md)
- [工具与生命周期](tooling-lifecycle.md)
