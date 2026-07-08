# Linkly AI 调研（对 sag 的借鉴）

> 一手来源：[linkly.ai](https://linkly.ai/) · [官方文档 Introduction](https://linkly.ai/docs/en/introduction) ·
> [LinklyAI/linkly-ai-skills](https://github.com/LinklyAI/linkly-ai-skills)（2026-07 抓取）。

## 一、产品速览

**定位**：「为 AI 而建的本地文档搜索引擎」——把本地文档变成 AI-ready 知识库，给任何 AI Agent
供给准确上下文。官方明确「**不是聊天应用、不是笔记软件**」：它只做上下文供给方。

**形态**：桌面 app（~20MB，后台常驻，全局快捷键唤起搜索栏）+ **CLI** + **MCP** + **官方 Agent Skills**。
本地优先：文件不出机器、无云上传（隐私即卖点）。

**能力**：多格式索引（PDF/DOCX/PPTX/EPUB/TXT/MD/HTML/图片 OCR）；全文 + 本地多语言模型语义
的混合检索；**大纲索引**（为每份文档建 outline，「逐步揭示相关部分」）。指标叙事：**5 分钟建好索引 ·
0.5 秒内响应 · 20MB 安装**。

**工具面**（Skills repo 披露，CLI 与 MCP 双通道同一套）：
`search`（关键词+相关度+过滤）· `find_paths`（容器名模糊定位）· `outline`（文档大纲/结构）·
`read`（**按行分页**读内容）· `grep`（正则精确匹配）· `list_libraries`（发现知识库）·
`explore`（主题概览 + 近期活动）· 诊断命令。

**Skills 发行**：`SKILL.md + references/{cli-reference, mcp-tools-reference, search-strategies,
troubleshooting}`，一行安装 `npx skills add LinklyAI/linkly-ai-skills`，兼容 Claude Code / Codex CLI
等任何支持 Agent Skills 开放标准的宿主。

## 二、与 sag 对照

| 维度 | Linkly AI | sag |
| --- | --- | --- |
| 定位 | 纯上下文供给方（无对话） | **双形态**：自带对话客户端 + 经 MCP 供给外部 agent |
| 检索 | 全文+语义混合、大纲索引 | SAG 引擎（分块+向量+事件-实体图谱），multi 策略 |
| Agent 接入 | CLI + MCP + Skills，工具面 8 个 | MCP（HTTP/stdio），工具面 3 个（search/get_entity/get_chunk） |
| 溯源 | read 按行分页 | chunk 级溯源 + 原始文件预览 |
| 形态 | 桌面常驻 + 全局快捷键 | Web self-host，⌘K 站内搜索 |
| 独有 | grep 精确匹配、explore 概览 | 引用式问答、事件-实体图谱、OpenAI 兼容端点 |

**本质差异**：Linkly 押注「agent 的文件系统式探索原语」（search→outline→read→grep 的漏斗）；
sag 押注「有据问答闭环」。两者互补——sag 的 MCP 工具面正缺 Linkly 那套探索原语。

## 三、可借鉴清单（按优先级）

**P0 · MCP 工具面补齐「探索原语」**（直接抬升外部 agent 可用性）
1. `outline(document_id)`：文档大纲（按 chunk heading + rank 拼装）——agent 先看结构再取内容，
   省 token、准定位。
2. `grep(pattern)`：分块表上的精确/正则匹配——语义检索之外，agent 找代码段/专名/编号是刚需。
3. `read(document_id, offset, limit)`：原文按行分页读取（文件端点已有，包成 MCP 工具）。
4. `list_documents`：信源内文档清单（名称/状态/计数），配合 outline 形成漏斗。

**P1 · 官方 Agent Skill**（明星项目传播利器，与「信源即 MCP」同构）
出 `sag-skills` 仓库：`SKILL.md + references/{mcp-tools, search-strategies, troubleshooting}`，
`npx skills add` 一键让 Claude Code/Codex 学会用 sag 检索。成本低（文档为主），
把「能被任何 agent 使用」从能力变成**开箱体验**。

**P2 · 叙事与体验**
5. README 指标叙事：学「5min/0.5s/20MB」，给 sag 一行可量化承诺（如「三步上手 · 上传即问 ·
   零基础设施单文件库」）。
6. `explore` 式概览工具：我们已有实体热度榜 + activity 端点，包成 MCP 工具几乎零成本——
   外部 agent 能感知「知识库里有什么、最近变了什么」。
7. 定位语显性化：首页/README 讲清双形态——「自己聊」（客户端）与「被挂载」（MCP/Skill/OpenAI
   端点）是同一知识库的两个出口。

## 四、不借鉴（及理由）

- **桌面常驻 + 系统级快捷键**：sag 是 self-host Web，⌘K 已覆盖站内场景；做 Tauri 壳是独立立项，
  非当前主线。
- **放弃对话只做供给方**：对话闭环（引用式问答）恰是 sag 的差异价值，不砍。
- **闭源商业形态**：sag 是开源示范，路线不同。

Sources: [Linkly AI 官网](https://linkly.ai/) · [Linkly AI Overview](https://linkly.ai/docs/en/introduction) · [linkly-ai-skills (GitHub)](https://github.com/LinklyAI/linkly-ai-skills)
