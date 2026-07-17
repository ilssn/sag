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

**模型凭据（Model Credentials）**:
用户为生成、向量化和文档解析服务提供的 API Key；V1 在 Web 与桌面中沿用统一的后端设置存储，接口和日志不得回传正文，完整数据备份会包含这些凭据。
_Avoid_: 本机访问密钥、界面可读取的普通设置

**应用数据目录（Application Data Directory）**:
桌面版用于持久保存数据库、知识索引和导入文件的系统标准本机目录，由稳定的应用标识定位；用户可以查看或受控迁移该目录。它不是用户主目录下的 `.sag`，也不包含可删除的缓存或日志。
_Avoid_: 工作目录、`.sag`、缓存目录、用户导出目录

**桌面运行配置（Desktop Runtime Profile）**:
客户端内置 FastAPI 使用的受约束运行配置，固定采用 SQLite、LanceDB 和应用数据目录以实现零基础设施启动；它与可配置外部存储的自托管运行配置共用业务代码。
_Avoid_: 桌面专用业务后端、前端构建变量、让客户端用户选择数据库基础设施

**存储键（Storage Key）**:
数据库中用于定位应用托管文件的相对标识，由统一存储层在当前应用数据目录下解析；数据目录迁移或跨平台恢复不会改变存储键。
_Avoid_: 绝对文件路径、用户提供的任意路径

**数据库迁移（Database Migration）**:
客户端启动业务服务前执行的版本化元数据库升级；迁移前创建恢复点，成功后 sidecar 才进入就绪状态，失败时保留原数据并进入恢复流程。
_Avoid_: `create_all`、启动时临时补列、静默忽略迁移失败

**知识索引数据（Knowledge Index Data）**:
zleap-sag 生成并持久保存的向量、事件、实体及关系索引；它随应用数据版本化迁移，不能因升级不兼容而被静默删除或自动重新抽取。
_Avoid_: 缓存、可随时重建的数据

**桌面主实例（Desktop Primary Instance）**:
每个系统用户唯一拥有桌面窗口、应用数据锁、FastAPI sidecar 和本机集成端点的 SAG 进程；后续启动请求只唤醒该实例。
_Avoid_: 每个窗口一个后端、多个客户端共享活动数据目录

**Sidecar 启动协议（Sidecar Startup Protocol）**:
Tauri 与 FastAPI sidecar 之间带一次性 nonce 的结构化启动状态流；sidecar 依次报告启动、迁移、初始化、就绪或错误，只有验证就绪事件后前端才获得运行时配置。
_Avoid_: 固定等待时间、只按端口是否可访问判断就绪
