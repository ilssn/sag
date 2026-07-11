# SAG

SAG 是面向个人与 Agent 的知识库应用。品牌愿景是成为用户管理、检索和复用知识时需要的最后一个知识库应用。

## Language

**知识库应用（Knowledge Base Application）**:
用户直接使用的完整产品，包含知识导入、组织、检索、溯源、对话与复用能力。SAG 的品牌表达是“你的最后一个知识库应用”。
_Avoid_: 用“知识库”单独指代完整产品

**知识库（Knowledge Base）**:
知识库应用内由信源、文档及其结构化索引组成的知识集合，不等同于应用本身。
_Avoid_: 应用、产品

**SAG**:
用户直接使用的完整知识库应用，也是本仓库交付的产品。
_Avoid_: 用 SAG 单独指代论文方法或 Python 包

**SAG 检索架构（SAG Retrieval Architecture）**:
SAG 论文原创提出的 event-entity 索引与查询时动态超边检索方法。它不是传统 RAG 与 GraphRAG 的组合、封装或双路召回。
_Avoid_: SAG 应用、zleap-sag、RAG 与 GraphRAG 的融合方案

**统一检索管线（Unified Retrieval Pipeline）**:
SAG 检索架构以原创的 event-entity 索引和执行机制，同时提供语义相似性检索与关系推理能力，替代在传统 RAG 与 GraphRAG 之间选型或部署两套系统再拼接结果的做法。
_Avoid_: 双 RAG、传统 RAG 与 GraphRAG 的融合或末端拼接

**zleap-sag**:
实现 SAG 检索架构并向其他应用提供导入、抽取和检索能力的 Python 引擎。
_Avoid_: SAG 应用

**SAG 自托管 API（SAG Self-hosted API）**:
SAG 应用随 FastAPI 后端提供的 HTTP、OpenAI 兼容和 MCP 接口。开发者在自己的服务器上运行 SAG 后使用这些接口连接自定义前端或外部 Agent；它不是由项目方托管的公共云 API。
_Avoid_: zleap-sag Python API、公共云 API
