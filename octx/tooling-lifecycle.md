# OCTX 工具与生命周期

> 状态：v1 设计基线。本文定义参考工具、zleap-sag 适配层及 Asset、Release、Package、Installation 的行为边界。

## 1. 分层

```text
独立 octx 包
  -> create_octx
  -> open_octx
  -> validate_octx
  -> CLI create / inspect / validate / unpack

zleap-sag
  -> 依赖并重新导出 octx 公共入口
  -> import_octx
  -> export_octx
  -> 缺失结构生成与 SAG 索引物化

SAG 应用
  -> 预览、确认、安装、升级、回滚和资产管理 UI
```

`octx` 不依赖 SAG 数据库。其他知识系统可以直接依赖 `octx`，实现自己的 import/export 适配器。

## 2. 领域对象

### Asset

跨多个 Release 延续的知识资产。首次创建时生成并持久化 `asset_id`，之后不得因重新打包而改变。

### Release

Asset 的一个 SemVer 发布版本。构建状态属于生产者本地记录：

```text
building -> ready
         -> failed
```

失败不会删除 Asset；同一 Asset 可以修复后再次创建 Release。

### Package

某个 ready Release 的不可变逻辑快照。由 `asset_id + version + package_digest` 精确确认，可以表示为目录或 `.octx` ZIP。

### Installation

某个 Package 在本地知识系统中的安装状态。它可以附带本地生成的结构、向量和产品配置，但不能改写原 Package。

### Derived Asset

从外部 Package 修改、恢复或增强后形成的新知识资产。它获得新的 `asset_id`，并通过 `asset.derived_from` 记录直接来源。

## 3. 创建

### 3.1 公共入口

创建侧只暴露一个高层 Python 入口：

```python
result = create_octx(...)
```

CLI 只暴露一个主命令：

```text
octx create <workspace> --from <markdown-dir> --name <asset-name> -o <file.octx>
octx create <directory> --in-place --name <asset-name> -o <file.octx>
octx create <workspace> --version <semver> -o <file.octx>
octx create <expanded-external-package> --derive -o <derived.octx>
```

首次身份建立和 Release 打包是内部阶段，不要求调用者组合 `init + pack` 两个函数。

### 3.2 首次创建

默认 `--from` 流程：

1. 创建新的 OCTX Working Directory。
2. 把源目录 Markdown 按相对路径复制到 `knowledge/`，不修改源文件。
3. 对普通 Concept Document 补齐最小 OKF/OCTX frontmatter。
4. 生成并持久化 Asset UUIDv7。
5. 为每篇 Concept Document 生成稳定 UUIDv7。
6. 构建并验证首个 Release。
7. 原子写出 `.octx`。

最小 frontmatter 补全：

- 缺失 `type`：写入通用 `Document`。
- 缺失 `title`：优先使用第一个 H1，否则使用文件名。
- 缺失 `octx.document_id`：生成 UUIDv7。
- 已有字段和值不覆盖。
- YAML 无法安全解析时报告错误，不猜测重写。
- `index.md` 和 `log.md` 不生成文档 ID。

如果普通 Markdown 来源中恰好存在不符合 OKF 导航/日志结构的 `index.md` 或 `log.md`，create 必须提示其为保留文件并要求用户重命名或修正，不能静默把它当作 Concept Document，也不能擅自改名破坏链接。

`--in-place` 允许改造原目录。工具必须先显示将移动和修改的文件，并由用户明确选择；它不能成为默认路径。

目标已经存在 Asset 身份时，create 必须复用，不能重新初始化或覆盖 ID。

展开的外部 Package 没有本地 producer state。内容未变化时，create 可以无损重新封装同一逻辑 Package，但不能借此续发原 Asset；内容发生修改或增强时，必须显式 `--derive`，生成新的 Asset ID，并把原 Package 三元组写入 `asset.derived_from`。

无损重封装逐字保留未知 manifest 字段。新 Release 和 Derived Asset 则重新生成当前工具理解的 Core manifest、Release 与文件清单，不继承来源中的未知签名、证明或文件级断言；需要这些字段时，必须交给理解其语义的生产者重新声明。

### 3.3 Release 版本保护

- 首个 Release 未指定版本时使用 `1.0.0`。
- 相同内容可以重建同一版本 Package，Package Digest 保持不变。
- 内容或参与摘要的 manifest 信息变化时，必须使用更高 SemVer。
- 参考 create 工具不提供生成“同 Asset、同版本、不同摘要”的普通强制参数。
- 构建先写临时文件，完整验证成功后再原子替换目标输出。
- 如果发布输出已经落盘、但本地状态仍停留在 `building`，下次创建仍以 workspace 中已发布 manifest 的版本与摘要作为不可变基线，不允许复用同一版本发布不同内容。

## 4. 打开与校验

### 4.1 `open_octx()`

```python
package = open_octx(source)
```

职责：

- 打开 `.octx` 或 OCTX Working Directory。
- 执行容器、路径和基础资源安全检查。
- 解析 manifest。
- 返回只读 Package Reader。
- 流式遍历 Documents、JSONL records、relations 和 vectors。

`open_octx()` 不写数据库，也不表示所有 schema、摘要和关系已经通过完整校验。

### 4.2 `validate_octx()`

```python
report = validate_octx(package_or_source)
```

职责：

- 校验 Core 与格式版本。
- 校验规范路径、文件清单和逐文件 SHA-256。
- 重新计算 Package Digest。
- 校验 JSON Schema 与 Arrow schema。
- 校验 ID 唯一性、引用、关系和层级。
- 分别给出 Core、Capabilities 和 Profiles 的有效性。
- 生成结构化问题列表和可选安装计划信息。

任何 import 实现都必须在自身事务中确保验证成功，不能相信调用方之前运行过 validate。

### 4.3 错误报告

普通 schema 与关系问题尽量一次返回。每项至少包含：

```json
{
  "code": "OCTX_EVENT_MISSING_CONTENT",
  "severity": "error",
  "path": "data/events.jsonl",
  "line": 18,
  "record_id": "optional-uuid",
  "message": "event.content is required"
}
```

`line` 和 `record_id` 只在适用时出现。实现可以设置普通错误数量上限。

以下问题立即停止读取相关可疑内容：

- 路径穿越或目标逃逸。
- 链接、特殊文件或加密条目。
- 条目数量、大小或压缩比超限。
- 文件摘要或 Package Digest 失配。

完整性错误不能被用户确认绕过。

## 5. 导入 SAG

### 5.1 公共入口

```python
result = import_octx(source, options=...)
```

`import_octx()` 属于 `zleap-sag`，不属于通用 OCTX Core。

### 5.2 安装计划

普通有效 Package 在调用方显式执行 import 后直接安装，不再增加一次确认。

以下计划需要明确确认：

- 同 Asset、同版本、不同 Package Digest 的 Release 冲突。
- 安装低于当前版本的显式回滚。
- 放弃已声明但无效的结构层，只安装 Core 并重建。
- 从无效 Core 提取可读 Markdown 并创建派生 Asset。

交互式 CLI 可以询问。Python API 不弹出交互，而是返回：

```text
confirmation_required + structured installation plan
```

调用方携带对应明确选项再次执行。

### 5.3 原子安装

1. 完整验证输入。
2. 在隔离 staging 中建立 Asset、Release、Installation 与 SAG Source 映射。
3. 写入有效 Core 和可以复用的结构/向量。
4. 校验本地映射完整性。
5. 单事务提交或原子切换。
6. 失败时清理 staging，原有 Installation 保持不变。

`open_octx()`、`validate_octx()` 和 `inspect` 永远不触发这些写入。

## 6. 重复、升级、冲突与回滚

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

## 7. 安装与索引生命周期

```text
validated
  -> installed
  -> indexing
  -> ready
       or degraded
```

- `installed`：有效 Core 已原子安装，可以浏览。
- `indexing`：后台生成缺失或不兼容的结构/向量。
- `ready`：当前消费者需要的检索能力全部可用。
- `degraded`：部分索引失败，Core 继续可用并可重试。

有效 Core-only 或部分 Capability Package 是正常输入。安装后自动从第一个缺失层开始补建，不要求错误确认。

已声明但无效的数据不同：必须先展示验证错误，由用户明确选择是否放弃该结构并重建。

`sag-structured` 是 Package Profile；`ready` 是 Installation 状态，两者不能混用。

## 8. 本地重建

重建结果附着于 Installation，不写回原 Package：

| 首个无效或缺失层 | 重建范围 |
| --- | --- |
| chunks | chunks、events、entities、相关 vectors |
| events | events、entities、相关 vectors |
| entities | entities、相关 vectors |
| vectors 目标 | 对应完整目标 |

无效层不做单条记录补丁，也不混用该层的新旧抽取结果。已验证上游可以复用。

Core 本身无效时不得安装原 Asset。用户可以明确提取可读 Markdown，使用新的 Asset 和文档身份创建 Derived Asset。

## 9. 导出 SAG

```python
result = export_octx(source_or_asset, output, version=...)
```

默认行为：

- 本地创建工作资产沿用其 `asset_id`。
- 只有 chunks、events、entities 和两层关系完整时才导出结构并声明 `sag-structured`。
- 结构半成品不进入 Package。
- 每个导出的向量目标必须完整；不完整目标省略。
- `core_only=True` 可以只导出 Markdown。

导入 Package 后生成的本地增强数据如果需要重新传播，必须先创建新的 Derived Asset，并记录：

```json
{
  "asset_id": "source-asset-uuid",
  "version": "source-version",
  "package_digest": "sha256:source-digest"
}
```

外部导入资产始终保持只读、可验证和可升级。

## 10. 本地配置边界

以下信息属于 Installation 或产品本地状态，不写回 OCTX Package：

- SAG Source ID 和数据库主键。
- Agent 绑定、收藏、权限和本地标签。
- 向量数据库、索引参数、距离度量和归一化策略。
- API 地址、密钥和供应商连接配置。
- 本地实体对齐和检索缓存。
- indexing / ready / degraded 状态。

Package 只保存可交换资产事实与明确声明的派生 payload。
