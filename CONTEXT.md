# SAG

SAG 是面向个人与 Agent 的知识库应用。品牌愿景是成为用户管理、检索和复用知识时需要的最后一个知识库应用。

## Language

**知识库应用（Knowledge Base Application）**:
用户直接使用的完整产品，包含知识导入、组织、检索、溯源、对话与复用能力。SAG 的品牌表达是“你的最后一个知识库应用”。
_Avoid_: 用“知识库”单独指代完整产品

**知识库（Knowledge Base）**:
知识库应用内由信源、文档及其结构化索引组成的知识集合，不等同于应用本身。
_Avoid_: 应用、产品

**知识宇宙（Knowledge Universe）**:
知识库中事件、实体和事实关系的有界 3D 探索视图；它是同一事实库的交互投影，不是第二份知识内容。
_Avoid_: 全库图、第二知识库、独立知识图谱

**信息源探索会话（Source Browse Session）**:
用户在单一信息源快照内按时间或叙事顺序连续探索事实的会话；切换信息源即开始新会话。
_Avoid_: 搜索会话、全库会话、跨信息源缓存

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

**本机集成端点（Local Integration Endpoint）**:
桌面版向同一台电脑上的外部宿主提供 API 与 MCP 的稳定入口；主机固定为 `127.0.0.1`，MCP 路径固定为 `/mcp/`，端口采用公开默认值并允许用户修改和持久化。端口冲突必须显式修复，不能静默改变外部宿主已保存的地址。
_Avoid_: 客户端内部 API、每次启动随机地址、可任意填写的完整 URL

**本机访问密钥（Local Access Key）**:
桌面版首次安装时自动生成、供同一台电脑上的外部 API/MCP 宿主共用的单一长期密钥；默认访问当前用户的整个知识库，不按宿主、信源或有效期拆分，用户只能复制或重新生成它。
_Avoid_: 登录令牌、个人访问令牌列表、细粒度权限系统
