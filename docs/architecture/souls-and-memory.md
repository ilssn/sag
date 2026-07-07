# 灵魂与记忆

> 「灵魂」是产品的情感锚点与主要交互对象。它把「知识库机器人」升华为「有名字、有人格、有记忆、越用越懂你的存在」。

## 灵魂 = 名字 + 人格 + 绑定 + 记忆

```
Soul「阿默」
├─ 名字 / 头像
├─ Persona 人格（行为与语气）
├─ 绑定 Bindings → [Namespace「知识」, Source「飞书消息」, …]   ← 它能看到的上下文
└─ 会话记忆 Namespace（自动创建）→ 与它的每次对话沉淀于此    ← 它记得的东西
```

## Persona（人格）schema

```json
{
  "system_prompt": "你是阿默，小艾的私人助理，简洁、克制、可靠。",
  "greeting": "我在。今天想理清什么？",
  "voice": "简洁 / 专业 / 温和",
  "traits": ["严谨", "先给结论", "必要时追问"],
  "guardrails": ["只依据绑定上下文作答", "不臆造", "涉密不外泄"],
  "search_strategy": "multi",
  "top_k": 8,
  "temperature": 0.3
}
```

- `system_prompt` 与 `guardrails` 决定行为；`voice/traits` 塑造语气；检索参数决定「记性广度」。
- **人格可由多种来源生成**：手动、从书中人物自动生成（[plugins-and-mounts](plugins-and-mounts.md#书人物)）、从挂载导入。

## 对话流（含记忆闭环）

```
用户 → 灵魂「阿默」发问 q
  1. 定位/新建 会话：thread 绑定 soul_id；首轮时在阿默的「会话记忆」空间新建一个
     conversation 信源 memory_source_id
  2. 落库用户消息（含 author）
  3. 多信源 fan-out 检索：
        targets = 展开(soul_bindings)  ∪  {memory_source_id}   ← 绑定上下文 + 自己的记忆
        sections = EngineManager.search_many(targets, q)  → 合并/重排 → top_k
  4. 组装：Persona.system_prompt + sections（带编号引用）+ 近期对话历史
  5. LLM 流式生成（SSE）→ 带 [n] 引用
  6. 落库助手消息
  7. 记忆写入：把「本轮问答」作为一条写入 memory_source → 入队 extract
        → 事件/实体沉淀，下次可被检索（闭环）
```

关键点：
- **多人对同一灵魂**：每个用户/会话是一个独立 `conversation` 信源，但都落在该灵魂的「会话记忆」命名空间；灵魂检索时可选「仅本人记忆」或「全部记忆」（隐私开关）。
- **记忆可治理**：抽取可异步、可批量摘要（长会话→摘要块）、可设保留期（TTL）、可手动「遗忘」某条。

## 多信源 fan-out（`sag/` 新增）

```python
async def search_many(source_config_ids, query, *, strategy, top_k) -> list[RetrievedSection]:
    results = await gather(search(cid, query, top_k=top_k*2) for cid in source_config_ids)  # 并发
    merged  = normalize_and_merge(flatten(results))     # 统一分数口径
    return rerank(merged)[:top_k]                        # 可接 rerank 模型
```
- 并发受连接池/引擎并发限制约束（每源一把锁已具备）。
- 合并：先按分数归一，去重（chunk_id），再截断；可选交给 rerank 模型精排（Persona 可开关）。
- 无绑定上下文的「纯记忆灵魂」：targets 只含记忆源，退化为「和记忆聊天」。

## 默认命名空间与自动化

- 新建工作空间：自动建「会话记忆」(kind=memory) + 「知识」(kind=knowledge)。
- 新建灵魂：在「会话记忆」下自动建**该灵魂专属**子记忆空间（或用共享 memory 空间 + soul_id 归属，二选一，推荐后者更简单）。
- 用户无需理解这些机制：他只是「创建一个灵魂，绑定一些上下文，开始聊」。复杂度藏在系统里。

## 与现有代码的差量

| 现状 | 演进 |
|---|---|
| `ChatThread.source_id`（单源） | `thread.soul_id` + `memory_source_id`；检索走 fan-out |
| 单信源 `search` | `search_many`（`sag/`） |
| 无人格 | `souls.persona_json` 注入 system prompt |
| 会话不落上下文 | 每轮写入 conversation 信源 + extract |

> 落地顺序建议：先做 Namespace/Soul/绑定 + fan-out（让灵魂能跨源问答），再做「会话→记忆」闭环（让它有记性）。见 [roadmap](../roadmap.md)。
