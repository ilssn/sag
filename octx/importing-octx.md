# 导入与安装

> 状态：v0.1 设计基线。本文以 SAG 为例说明 `.octx` 的导入、升级、冲突处理、安装状态和本地重建。

## 将 OCTX 导入 SAG

### 公共入口

```python
result = import_octx(source, options=...)
```

`import_octx()` 属于 `zleap-sag`，不属于通用 OCTX 工具链。其他知识系统可以提供自己的 `.octx` 导入适配器。

### 安装计划

普通有效 Package 在调用方显式执行 import 后直接安装，不再增加一次确认。

以下计划需要明确确认：

- 同 Asset、同版本、不同 Package Digest 的 Release 冲突。
- 安装低于当前版本的显式回滚。
- 放弃已声明但无效的结构层，只安装有效 Markdown 并重建。
- 从无效 Package 提取可读 Markdown 并创建派生 Asset。

交互式 CLI 可以询问。Python API 不弹出交互，而是返回：

```text
confirmation_required + structured installation plan
```

调用方携带对应明确选项再次执行。

### 原子安装

1. 完整验证输入。
2. 在隔离 staging 中建立 Asset、Release、Installation 与 SAG Source 映射。
3. 写入有效 OCTX 文档和可以复用的结构与向量。
4. 校验本地映射完整性。
5. 单事务提交或原子切换。
6. 失败时清理 staging，原有 Installation 保持不变。

`open_octx()`、`validate_octx()` 和 `inspect` 永远不触发这些写入。

## 重复、升级、冲突与回滚

| 输入情况 | 行为 |
| --- | --- |
| `package_digest` 已安装 | 幂等返回，不创建第二份内容 |
| 新 `asset_id` | 创建新 Asset、Installation 和 SAG Source |
| 相同 Asset、更高版本 | 用户发起 import 后原子升级现有 Installation |
| 相同 Asset、较低版本 | 只允许明确回滚 |
| 相同 Asset + version + digest | 同一 Release，幂等 |
| 相同 Asset + version、不同 digest，且两个包都有效 | `release_conflict`，必须确认 |
| 单个包声明 digest 与计算结果不符 | 完整性失败，拒绝安装 |

冲突确认只切换当前 Installation 指向的新 Package。旧 Package、摘要和安装历史继续保留。

升级时保留本地 Source ID、显示名称、标签、收藏、权限和 Agent 绑定等产品配置；OCTX 管理的 Documents、Chunks、Events、Entities、relations 和 vectors 使用新 Release 快照整体替换。

历史保存期限和存储清理由消费者本地策略决定，不改变 Package 身份。

## 安装与索引生命周期

```text
validated
  -> installed
  -> indexing
  -> ready
       or degraded
```

- `installed`：有效 OCTX 文档已原子安装，可以浏览。
- `indexing`：后台生成缺失或不兼容的结构与向量。
- `ready`：当前消费者需要的检索能力全部可用。
- `degraded`：部分索引失败，OCTX 文档继续可用并可重试。

仅含 Markdown、未声明 `sag-structured` 的有效 Package 是正常输入。安装后可以在本地生成完整 SAG 结构，不要求错误确认。

已声明但无效的数据不同：必须先展示验证错误，由用户明确选择是否放弃该结构并重建。

`sag-structured` 是 Package Capability；`ready` 是 Installation 状态，两者不能混用。

## 本地重建

重建结果附着于 Installation，不写回原 Package：

| 无效或缺失内容 | 重建范围 |
| --- | --- |
| SAG 结构中任一层 | chunks、events、entities、关系及相关 vectors |
| vectors 目标 | 对应完整目标 |

无效 SAG 结构不做单条记录补丁，也不混用新旧抽取结果；向量无效时只重建对应完整目标。

OCTX 格式无效时不得安装原 Asset。用户可以明确提取可读 Markdown，使用新的 Asset 和文档身份创建 Derived Asset。
