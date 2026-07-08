# 插件与挂载（拓展层）

> zleap 不止是一个网站。它要成为**任意 Agent 的上下文与灵魂来源**。这一层把「上下文」以 Agent 原生的方式（MCP / Skill / Hook）投送出去，并支持把灵魂「挂载/夺舍」进本地 Agent。

## 上下文插件：MCP / Skill / Hook

zleap 把「某个灵魂的上下文」暴露为标准接口，供外部 Agent 消费：

| 形态 | 作用 | 面向 |
|---|---|---|
| **MCP Server** | 暴露工具：`search_context`、`get_entity`、`list_sources`、`remember` | 任意 MCP 宿主（Claude Code / Cursor / …） |
| **Skill** | 打包「如何用这个灵魂」的说明 + 触发词 | 支持 skill 的宿主 |
| **Hook** | 在宿主生命周期（如每次提问前）注入相关上下文 | 支持 hook 的宿主 |

核心工具（MCP）：
```
search_context(query, top_k?)   → 跨该灵魂绑定上下文+记忆检索，返回带引用的段落
get_entity(name|id)             → 事件-实体图谱里的实体详情
remember(text)                  → 往灵魂的会话记忆写入一条（让本地交互也能沉淀）
list_namespaces() / list_sources()
```
令牌作用域 = 单个灵魂的**只读上下文**（`remember` 除外），可吊销、限流、进审计。

## 挂载：知识挂载 vs 全量夺舍

「挂载」= 把 zleap 装进本地 Agent。流程：**下载插件包 → 填入 key → 一键导入**。

### 知识挂载（Knowledge Mount，安全默认）
- 只把 zleap 作为**上下文源**接入（MCP `search_context`）。本地 Agent 回答时能引用你的私有知识。
- 不改本地 Agent 的人格；随时移除。

### 全量夺舍（Full Possession，戏剧化但可逆）
把本地 Agent「变成」你的灵魂：
```
1. 备份：读取本地 Agent 的人格/配置文件 → 存入 mounts.backup_json（可还原）
2. 写入：把灵魂的 name + persona.system_prompt + greeting 写入本地 Agent 的人格位
3. 注入上下文：同时挂载 MCP（search_context/remember）
4. 提示：启动时打印「阿默已登录到本地 🎉」
5. 还原：一键 restore → 从 backup_json 写回旧人格，移除挂载
```
- **可逆是底线**：任何写入前先备份，还原一键完成，审计留痕。
- **Host 适配器**：不同宿主人格位不同（Claude Code 的 CLAUDE.md/settings、Cursor 的 rules、通用 MCP 仅工具）。用 `MountAdapter` 抽象：`detect() / backup() / apply(persona) / restore()`。新增宿主 = 实现一个适配器。

```python
class MountAdapter(ABC):
    host: str
    def detect(self) -> bool: ...
    def backup(self) -> dict: ...
    def apply(self, soul_name, persona): ...   # 写入名字+人格（+可选 MCP 配置）
    def restore(self, backup): ...
```

### 挂载包（分发）
- 一个轻量 CLI / 安装器：`zleap mount --soul <id> --host claude_code --key <token>`。
- 或图形化：zleap 网站「挂载向导」生成一段命令 / 一个配置文件，用户粘贴即用。
- 包内含：MCP 配置模板 + 适配器 + 人格写入逻辑；key 决定连哪个灵魂。

## 书 → 人物灵魂（Context App 示范）

把「上传一本书 → 与书中人物对话」做成一个建立在基座之上的**上下文应用**：

```
1. 上传书 → 作为 document 信源 → SAG ingest + extract（事件-实体图谱）
2. 洞察页：从图谱聚合实体
     - 按类型分组（person / place / org / event…）
     - 人物「热度榜」= 出现频次 × 图谱中心度（可加情节跨度）
3. 点某人物「提取成灵魂」：
     - 收集该实体相关的事件/描写片段
     - LLM 依据这些片段自动起草 persona（名字、语气、立场、口头禅、guardrails=「只依据书中情节」）
     - 绑定该书信源作为上下文，origin=book_entity，origin_ref={book_source_id, entity_id}
4. 对话：和「关羽」聊走麦城、和「诸葛亮」聊北伐结局——回答受书中事件约束、带引用
```
这套流水线**完全复用**基座：实体来自 SAG 图谱，人格用 LLM 生成，对话用灵魂 fan-out。它证明「基座 + 想象力 = 明星功能」。

## 为什么这些能落地

- MCP/挂载只是**基座能力的对外投影**：本质还是 `search_context` = fan-out 检索。
- 书→人物只是**图谱聚合 + 人格生成 + 灵魂**的组合。
- 拓展层不发明新地基，只在既有支点（sag 检索 / souls / connectors）上做组合与适配。这正是「从基础出发，再拓展」。
