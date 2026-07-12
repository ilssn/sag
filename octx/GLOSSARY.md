# Open Context 领域词汇表

本文统一 OCTX 及其与 SAG、zleap-sag 集成时使用的领域语言。

## SAG 相关术语

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
实现 SAG 检索架构并向其他应用提供导入、抽取和检索能力的 Python 引擎。它依赖独立 `octx` 参考包，重新导出通用的 OCTX create/open/validate 入口，并增加 SAG 专属 import/export 适配。
_Avoid_: SAG 应用

**SAG 自托管 API（SAG Self-hosted API）**:
SAG 应用随 FastAPI 后端提供的 HTTP、OpenAI 兼容和 MCP 接口。开发者在自己的服务器上运行 SAG 后使用这些接口连接自定义前端或外部 Agent；它不是由项目方托管的公共云 API。
_Avoid_: zleap-sag Python API、公共云 API

## OCTX 术语

**OCTX 格式（OCTX Format）**:
OCTX 是 Open Context 的简称与技术标识，发布文件扩展名为 `.octx`。它是建立在 OKF 知识内容之上的开放、厂商中立上下文资产封装与派生数据标准，增加身份、版本、完整性、安装语义及可选索引层；SAG 与 zleap-sag 是生产者和消费者，但不是使用前提。OCTX 不定义搜索 API、召回算法或 Agent 协议。
_Avoid_: OKF 竞争格式、SAG 专有格式、数据库备份格式、zleap-sag 存储格式

**OCTX 参考工具链（OCTX Reference Tooling）**:
独立于任何知识系统的规范实现，负责 OCTX 的 create、open/inspect、validate 和 unpack，并提供 JSON Schema Draft 2020-12、固定 Arrow schema、规范样例与一致性测试。公开创建入口统一处理首次身份建立和后续 Release，读取类入口不写知识数据库。数据库映射、内容抽取和索引构建由各系统自己的适配层负责。
_Avoid_: zleap-sag、SAG 导入器、知识抽取引擎

**OCTX Core**:
所有合规 OCTX 实现都必须支持的最小互操作层，由至少一篇 OKF 兼容 Markdown 知识文档和 OCTX 资产封装组成。普通 OKF bundle 可以无损封装为 Core，但在缺少 manifest、稳定身份和摘要时还不是完整 OCTX Package；只有扩展或派生数据而没有知识文档的 Package 无效。
_Avoid_: SAG Profile、可选能力集合、最小 SAG 数据库

**知识文档（OCTX Knowledge Document / OKF Concept）**:
OCTX Core 中一篇符合 OKF Concept 约定的 Markdown 文件，是 v1 唯一正式 Document，也是人和 Agent 可以直接阅读、链接和维护的知识单元。OKF 保留的 `index.md` 与 `log.md` 是导航和日志文件，不属于 Knowledge Document。文档路径负责 OKF 导航，frontmatter 中的 `octx.document_id` 负责跨版本及派生数据引用；转换前 PDF、DOCX 等不进入 OCTX v1。
_Avoid_: 转换前 PDF、chunk、event、数据库行

**OCTX Frontmatter 命名空间（`octx`）**:
知识文档 YAML frontmatter 中专门保存 OCTX 扩展字段的对象。v1 在其中定义 `document_id`，避免把通用的 `document_id` 直接放入 OKF 的共享顶层字段空间。
_Avoid_: 顶层 `document_id`、`octx_id`、生产者私有字段集合

**OCTX 能力层（OCTX Capability）**:
在 Core 之上增加一种标准数据能力的版本化模块，例如 chunks、events、entities 或 vectors。manifest 以 capability 名称为 key 并只声明版本；文件路径与依赖由规范固定。关系文件随 events 或 entities 提供，不构成独立 capability。
_Avoid_: 私有字段集合、OCTX Profile、数据库插件

**OCTX 私有扩展数据（OCTX Private Extension Data）**:
保存在 `extensions/<反向域名命名空间>/<major.minor>/...` 中、尚未进入 OCTX 标准的数据，例如 `extensions/com.zleap.sag/1.0/data.jsonl`。文件必须列入 manifest 并参与 Package Digest；未知消费者可以忽略其语义，但 round-trip 时必须保留。私有扩展不能代替标准 Capability 或 Profile。
_Avoid_: 未列入 manifest 的附加文件、标准能力、SAG-structured 数据

**未知可选字段（Unknown Optional Field）**:
受支持 major 版本内、当前消费者尚不认识的 manifest、JSON 或 JSONL 字段。它不导致校验失败，重写 Package 时应被保留；但不能改变已知字段语义，也不能用来满足 Capability 或 Profile。
_Avoid_: 缺失的必填字段、未知 Capability、major 版本不兼容

**OCTX Profile**:
面向特定用途定义的一组能力要求和一致性约束。Profile 必须由 manifest 显式声明并通过校验，不能仅根据 capabilities 自动推导。SAG-structured Profile 要求显式、完整且相互一致的 chunk-event-entity 数据；声明失实时禁止导入结构层，但 Core 有效时可由用户明确选择只安装 Markdown 并重新生成。
_Avoid_: OCTX Core、厂商私有格式、产品配置预设

**SAG 结构数据（SAG-structured Data）**:
满足 SAG-structured Profile 的显式 chunks、events、entities 及关系集合，可以被兼容 SAG 消费者直接导入结构层。它要求每篇 Concept Document 有 Chunk、每个 Chunk 有 Event、每个 Event 有 Entity、每个 Entity 被 Event 使用，不允许孤立记录；缺失层必须通过真实分块或抽取流程生成，不能用上一级内容进行合成回退。
_Avoid_: 纯 OCTX Core、本地回退视图、未完成索引

**OCTX 实体（OCTX Entity）**:
OCTX Asset 内由生产者识别出的一个语义实体，而不是一次文字出现。每条记录必须有 `id`、`name` 和非空 `type`，`description` 可选；OCTX 不规定类型词表或命名格式。同一实体可关联多个 Events，并在同一 Asset 后续 Release 中保持 `entity_id`。`normalized_name` 属于消费者本地索引，不进入 OCTX，独立 Assets 中的同名实体也不自动合并。
_Avoid_: 实体提及、全局唯一实体、按名称自动合并的记录

**OCTX Event**:
从一个或多个显式 Chunks 中提取、可以脱离原 Chunk 独立理解的完整事件表达。每条 Event 必须有 `id`、`title` 和 `content`，并只通过 `chunk-events.jsonl` 记录来源。顶层省略层级字段并视为 level 0；子 Event 同时保存 `parent_id` 和 `level`。
_Avoid_: Chunk 摘要、只有标题的标签、内嵌 `chunk_id` 的关系副本

**OCTX 关系记录（OCTX Relation Record）**:
在 JSONL 中以两端逻辑 ID 表达的一条有向关系。关系本身没有 UUID，两端 ID 的组合就是身份且在对应文件内必须唯一；event-entity 关系可以附带 `weight` 和 `description`。
_Avoid_: 数据库关联表主键、重复边、关系创建时间

**OCTX ID**:
OCTX 对 Asset、Knowledge Document、Chunk、Event 和 Entity 使用的 UUIDv7 身份，以小写、带连字符的规范 UUID 字符串保存，不加类型前缀。知识文档使用 `octx.document_id`，派生记录使用各自的 `id`。ID 表示对象身份，内容摘要负责内容判等，两者不能互相替代。
_Avoid_: 数据库自增主键、内容摘要、带类型前缀的私有 ID

**OCTX 资产（OCTX Asset）**:
跨多个发布版本延续的可传播知识资产，由稳定的资产身份标识。一个 OCTX 资产可以先后产生多个 OCTX 知识包。
_Avoid_: OCTX 知识包、SAG 信源、数据库记录集合

**OCTX 发布版（OCTX Release）**:
OCTX 资产的一次有版本发布，记录知识包从构建到可用或失败的生命周期。一个成功发布版对应一个由内容摘要唯一确认的 OCTX 知识包。
_Avoid_: OCTX 资产、OCTX 知识包、导出任务

**发布版冲突（Release Conflict）**:
两个分别通过完整性校验的 OCTX Package 声明相同 `asset_id + release.version`，但具有不同 `package_digest`。导入方必须提示并要求确认；确认只切换当前 Installation，两个不可变 Package 及安装历史都要保留。单个 Package 的声明摘要与计算结果不一致是完整性失败，不是 Release 冲突。
_Avoid_: 静默覆盖、删除旧 Package、把冲突摘要视为同一内容

**OCTX 工作目录（OCTX Working Directory）**:
OCTX 逻辑目录树的可编辑形态，供人、Agent 和版本控制系统维护知识内容。它封装为 `.octx` 后成为便于分发的发布文件，但两种形态共享同一逻辑内容结构。
_Avoid_: OCTX 发布版、临时解压缓存、数据库目录

**OCTX 知识包（OCTX Package）**:
OCTX 资产某一版本的不可变知识快照，可以包含一篇或多篇文档，并保留可溯源证据与派生知识。它可独立分发、验证并导入，默认形成一个新信源。
_Avoid_: OCTX 资产、单篇文档包、数据库快照、SAG 信源

**逻辑内容摘要（Package Digest）**:
在验证 `manifest.files` 的逐文件 SHA-256 后，对移除自身摘要、按路径排列 files 并执行 JCS 的 manifest 计算副本进行 SHA-256 得到的不可变摘要。它确认某个发布版的准确内容，不受 ZIP 压缩等级、条目顺序、归档工具或安全但未列入清单的附加文件影响。
_Avoid_: ZIP 文件摘要、版本号、数字签名

**归档摘要（Archive Digest）**:
对某一次 `.octx` ZIP 文件的原始字节计算的传输校验值。同一逻辑知识包重新压缩后可以具有不同归档摘要。
_Avoid_: Package Digest、资产身份

**派生资产（Derived Asset）**:
以已有 OCTX 发布版或无效 Package 中仍可读取的 Markdown 为起点、但拥有新资产身份的可编辑知识资产。它通过 `asset.derived_from` 记录直接来源的资产 ID、版本和 Package Digest，却不再冒充原发布者资产的后续版本；从无效 Core 恢复时还必须为文档生成新的有效身份。本地增强后的导入资产一旦重新导出，也必须先成为派生资产。
_Avoid_: 原资产的新版本、原地修改的知识包、无来源副本

**OCTX 安装（OCTX Installation）**:
一个 OCTX 发布版在本地知识系统中经过校验并成为可用知识集合的状态。在 SAG 中，它表现为托管信源；升级安装是把本地集合原子切换到该资产的新发布版，不是修改已有知识包。有效 Core 或部分 Capability 安装后会自动补建缺失索引，缺失结构本身不属于安装错误。
_Avoid_: OCTX 知识包、导入任务、解压目录

**本地重建数据（Locally Rebuilt Data）**:
当 Package 缺少结构层、结构层无效或向量不兼容时，消费者从有效 Core Markdown 或已验证的上游层重新生成并附着于当前 Installation 的 chunk、event、entity、关系或向量。重建从首个无效 Capability 起覆盖该层及全部下游，不做单条修补或新旧混用。它不修改原 Package，也不能让原 Package 的无效 Capability 或 Profile 变为有效。
_Avoid_: 原 Package payload、修正后的 Release、静默跳过坏记录

**原文块（Source Chunk）**:
文档经过解析和分块后保留的完整原文证据单元，是 SAG 检索结果与引用最终返回的内容边界。OCTX Core 可以不携带原文块；一旦声明 chunks capability，就必须保留完整块内容，event、entity 或摘要不能替代它。
_Avoid_: 摘要、event、原始文件

**向量配置（Vector Configuration）**:
保存在 `vectors/config.json`、由必填 `model` 和可选 `revision` 组成的向量来源标识。OCTX v1 每个 Package 最多一套配置，所有随包 Arrow 文件共用；维度从 Arrow 读取，数值类型固定为 float32，距离算法和归一化由消费者本地决定。
_Avoid_: API 地址、密钥、供应商连接配置、多模型配置集合
