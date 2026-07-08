# RAGFlow 深度调研（2026-07-08）

> 方法：直读其 GitHub docs 源文件（guides/dataset·chat·memory、references、release notes）、Releases 时间线、云版定价页。
> 目的：把主竞品的**概念模型、配置颗粒度、记忆机制、体验取舍**摸到能做决策的深度，并落成对 muse 的行动结论。
> （首轮浅调研见 [research-convergence](research-convergence.md)；本篇为深挖。）

## 一、概念模型与用户旅程

用户操作对象（他们的词）：**File → Dataset（知识库）→ Chat assistant / Search app / Agent → Memory → Team**。

```
File 管理（独立于 dataset，一份文件可挂多个库，防误删）
  └→ Dataset：选 chunk 模板 → 解析 → chunk 可视化人工干预 → 检索测试
       └→ Chat assistant（多轮，绑多个 dataset，要求同 embedding 模型）
       └→ Search app（单轮，预定义混合检索）
       └→ Agent（工作流画布 + MCP + 代码执行器）——Memory 只在这里可用
```

体验特征：**工程师向的参数面板**。强大，但新手面对的是十几个模板、两套记忆、三层配置。

## 二、功能颗粒度（关键事实）

### Dataset / 解析
- **12 种 chunk 模板**：General / Q&A / Resume(企业版) / Manual / **Table(TSI)** / Paper / Book / Laws / Presentation / Picture / One(整篇一块) / Tag(标签集)。按文件类型适配。
- 解析生态凶猛：DeepDoc 自研 + MinerU / Docling / PaddleOCR(PP-OCRv6) / SoMark 可选；excel→HTML；PDF 解析器可选。
- **embedding 模型锁定**：库里有 chunk 后不可换模型，必须清空重来（多库助手要求同 embedding）。
- **chunk 人工干预**：双击编辑文本、增删 chunk、加关键词（提权）、加问题、打 tag——「Quality in, quality out」的落点。
- 增强项：自动关键词/自动问题、**RAPTOR**、**GraphRAG**（社区抽取带断点续跑）、PageRank、Tag set、child chunking、context window。
- **检索测试**：可调 相似度阈值(默认0.2) / 向量权重(默认0.3, 关键词0.7) / rerank(明示会显著变慢) / 知识图谱 / 跨语言；结果**拆解展示词项分与向量分**。⚠️ 坑：测好的参数**不会自动同步**到 assistant，要手抄——体验割裂点。

### Chat assistant（配置全景，含默认值）
- Assistant 层：**Empty response**（检索不中时固定回复→硬防幻觉；留空=放飞）、开场白、**Show quote 默认开**、绑多库。
- Prompt 层：system prompt、相似度阈值0.2、向量权重0.3、Top N、**多轮改写默认开**（用上下文重写查询）、知识图谱多跳、Reasoning（R1/o1 深度研究）、rerank、跨语言检索、**变量**（API 注入 prompt 占位符）。
- Model 层：每助手可换模型；创意三档预设（Improvise/Precise默认/Balance）+ 温度0.1 / TopP 0.3 / 存在惩罚0.4 / 频率惩罚0.7。
- 调试细节：灯泡图标可看**展开后的完整 prompt**——很好的透明性设计。

### Search app（≈ 我们的 ⌘K）
- 定位「单轮」；**预定义混合检索**（加权关键词+向量），不吃 KG/自动关键词等高级策略；用系统默认模型；结果=模型回答+按分排序的段落。
- 是独立创建的「应用」，一个搜索=一个 app——比我们的全局浮层重。

### Memory（v0.26 新，与我们正面交锋处）
- 独立实体（Overview >> Memory 创建），类型：**Raw(必选)/Semantic/Episodic/Procedural**；配 embedding+LLM；**默认 5MB**（≈500条消息）满了触发遗忘；权限 Only me/Team。
- **只在 Agent 画布可用**：Retrieval 组件读、Message 组件写——**需要用户手动接线**；与 dataset 体系不打通。
- 判断：他们把记忆做成了**开发者原语**；muse 把记忆做成**助手的默认能力**（自动写入-抽取-回灌，零配置）。这是产品哲学级差异，必须守住并讲清楚。

### 生态速度（0.26.x，仅六月～七月）
- 数据连接器：Outlook / OneDrive / Teams / Slack / SharePoint / Salesforce / Azure Blob / **BigQuery**。
- 聊天渠道：飞书 / Discord / WhatsApp / DingTalk / WeCom。
- MCP：server + `ragflow_list_datasets`/`ragflow_list_chats` 工具；Langfuse 会话级观测；模型商多 key。
- 结论：连接器/渠道是他们的**军备竞赛主战场**，投入巨大。

### API 面
- 资源化 REST：datasets / documents / **chunks 全 CRUD** / retrieval 独立端点 / chats / sessions / agents / KG·RAPTOR 构建+trace。
- **OpenAI 兼容**：`POST /api/v1/openai/{chat_id}/chat/completions`（agent 同款）——生态接入的万能钥匙。

### 云版定价
Free / $29 Starter / $129 Pro / Enterprise（配额差异：存储 5–50GB 等）。开源自部署全功能（Resume 模板等个别企业版限定）。

## 三、判断：强项与软肋

**强项**：解析工程深度（模板×OCR 生态）；参数全外露+带默认值；chunk 级人工干预；检索测试的分数拆解；API 完备（含 OpenAI 兼容）；连接器/渠道扩张速度；prompt 透明（灯泡）。

**软肋（我们的空间）**：
1. **概念负担重**——dataset/file 两层、chat/search/agent 三个应用、memory 又是第四种实体且要手接线；新手迷宫。
2. **配置割裂**——检索测试参数不回填 assistant；embedding 锁库；多库必须同 embedding。
3. **记忆是插件不是本能**——5MB、手动接线、与知识库不打通。
4. 体验整体**工程师向**，「优雅/克制」无从谈起。

## 四、对 muse 的行动结论

### 采纳（排入 roadmap）
| 优先 | 项 | 说明 |
|---|---|---|
| 高 | **OpenAI 兼容 completions 端点**（每助手一个） | 生态接入成本≈0，开源传播利器 |
| 高 | **Empty response 思想** | 助手设定加「检索无结果时的固定回复」开关，硬防幻觉 |
| 中 | **检索调试面板** | 我们已有 /search 端点；补 UI + 分数展示；**参数一键回填助手设定**（修掉他们的割裂坑） |
| 中 | **chunk 人工干预** | 已有 chunk 读端点；补编辑/禁用（PATCH），后续加关键词提权 |
| 中 | **prompt 透明** | 对话里可查看本轮展开后的完整 prompt（灯泡等价物） |
| 低 | 文档下载/预览端点 | 溯源链路的最后一米 |

### 守住差异（对外叙事要点）
- **记忆是本能不是插件**：自动沉淀-抽取-回灌 vs 5MB 手接线组件——写进 README 对比。
- **一步溯源**：引用→原文对话框已达成；他们要跳文档页。
- **30 秒概念模型**：四概念 vs 他们的七实体迷宫。
- **事件-实体图谱开箱即得**（SAG 抽取即建），非可选的重型 GraphRAG 流程。

### 不追（明确放弃）
- 12 模板矩阵与 OCR 军备（引擎层责任，随 zleap-sag 演进）；Agent 工作流画布；聊天渠道矩阵；RAPTOR。

### 观察
- 连接器需求强度（我们框架就绪，按用户呼声逐个开）；他们 memory 的后续融合动作。

## 附：Releases 时间线摘要（0.26.0 → 0.26.4，2026-06-11 → 07-07）
多源连接器八连发 → 飞书/Discord 渠道 → WhatsApp/钉钉/企微 → BigQuery + MCP 工具 + SoMark OCR → 16 语言词干化。节奏：**约每周一个 minor**。
