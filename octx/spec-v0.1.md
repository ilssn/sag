# OCTX v0.1 规范

> 状态：v0.1 设计基线。本文定义 OCTX 的规范行为；[机器可读 JSON Schema](schemas/README.md)、规范样例和一致性测试应与本文保持一致。

## 1. 范围

Open Context（简称 OCTX）把一个可版本化知识资产发布为不可变、自包含、可校验的 Package。Package 可以只包含人和 Agent 可直接阅读的 OKF Markdown，也可以声明标准 Capability 携带派生结构与向量。

OCTX 负责：

- Package、Asset 和 Release 身份。
- OKF 兼容知识文档。
- 规范 payload 文件清单。
- 逻辑内容完整性。
- Capability、Profile、版本和扩展边界。

OCTX 不负责搜索、排序、Agent 协议、数据库映射或索引运行时。

本文中的“必须”“不得”“可以”分别表示规范要求、规范禁止和实现可选行为。

## 2. 一致性分层

OCTX 使用三个独立层次：

1. **OCTX 格式**：所有实现都必须理解的 manifest、知识文档、身份、版本和完整性。
2. **Capability**：Package 实际携带的一种版本化标准数据能力。
3. **Profile**：面向特定用途、需要额外一致性约束的显式能力组合。

Capability 不能自动推导 Profile。未知 Capability 不阻止消费者读取有效 OCTX Package；消费者也不能声称满足自己无法验证的 Profile。

## 3. Package 与目录结构

`.octx` 是下面逻辑目录树的 ZIP / ZIP64 表示：

```text
example.octx
├── manifest.json
├── knowledge/
│   ├── index.md                    # 可选 OKF 导航
│   ├── log.md                      # 可选 OKF 日志
│   └── **/*.md                     # 至少一篇 Concept Document
├── data/
│   ├── chunks.jsonl                # chunks/0.1
│   ├── events.jsonl                # events/0.1
│   └── entities.jsonl              # entities/0.1
├── relations/
│   ├── chunk-events.jsonl          # events/0.1
│   └── event-entities.jsonl        # entities/0.1
├── vectors/
│   ├── config.json                 # vectors/0.1
│   ├── chunks.arrow
│   ├── events.arrow
│   └── entities.arrow
└── extensions/
    └── <namespace>/<major.minor>/...
```

只有实际需要的可选目录和文件才出现。空 `data/`、`relations/`、`vectors/` 或 `extensions/` 目录没有规范意义。

同一逻辑树也可以作为 OCTX Working Directory 存在。工作目录可编辑；发布后的 `.octx` Package 不可变。

## 4. ZIP 与路径

发布文件必须满足：

- ZIP 文件名使用 UTF-8，逻辑路径采用 Unicode NFC。
- 路径使用 POSIX `/` 分隔符并区分大小写。
- 只允许相对文件路径；禁止绝对路径、空路径段、`.`、`..`、反斜杠和 NUL。
- 规范化后重复的路径无效。
- 只接受普通文件；目录条目可以忽略。
- 禁止软链接、硬链接、设备节点和其他特殊文件。
- 禁止加密条目。
- v0.1 只要求消费者支持 ZIP STORE 和 DEFLATE；ZIP64 必须可用于大型 Package。

解包器必须在写入前校验目标路径，并检测目标文件系统上的名称冲突，不能覆盖目录外文件或已有不相关文件。消费者必须设置单文件大小、总展开大小、条目数量和压缩比等本地资源上限。

## 5. Manifest

`manifest.json` 是 UTF-8 JSON object。最小 OCTX manifest：

```json
{
  "format": "octx",
  "format_version": "0.1",
  "asset": {
    "id": "019c1234-5678-7abc-8def-0123456789ab",
    "name": "SAG Technical Research"
  },
  "release": {
    "version": "1.0.0",
    "created_at": "2026-07-12T10:00:00Z",
    "package_digest": "sha256:..."
  },
  "files": [
    {
      "path": "knowledge/sag.md",
      "sha256": "..."
    }
  ]
}
```

### 5.1 必填字段

| 字段 | 约束 |
| --- | --- |
| `format` | 固定为 `octx` |
| `format_version` | OCTX 格式版本，当前为 `0.1` |
| `asset.id` | 规范小写 UUIDv7 |
| `asset.name` | 非空字符串 |
| `release.version` | SemVer 2.0.0 |
| `release.created_at` | OCTX UTC 时间 Profile：`YYYY-MM-DDTHH:MM:SS[.fraction]Z`；秒为 `00` 到 `59`，不接受闰秒 `:60` |
| `release.package_digest` | `sha256:` 加 64 位小写十六进制 |
| `files` | 非空数组，每项只要求 `path` 与 `sha256` |

`files` 必须至少包含一篇 `knowledge/` 下非 `index.md`、非 `log.md` 的 Concept Document。

### 5.2 文件清单

- `files[].path` 在规范化后必须唯一。
- `files[].sha256` 是文件原始字节的 SHA-256，保存为 64 位小写十六进制，不带前缀。
- `manifest.json` 不列入 `files`，避免摘要自引用。
- 每个已声明标准 Capability 的必需文件都必须列入 `files`。
- 清单文件缺失、摘要失配或同一路径重复时 Package 无效。
- 安全但未列入 `files` 的普通 ZIP 文件被忽略，不导入、不解包、不计入 Package Digest，重打包时不保留。
- 未列入清单的危险路径、链接、特殊文件或加密条目仍然必须拒绝。

`files` 定义完整规范 payload，而不是 ZIP 中所有无关附加字节。

### 5.3 可选声明

`capabilities` 和 `profiles` 都是以名称为 key、值为版本对象的 JSON object：

```json
{
  "capabilities": {
    "chunks": {"version": "0.1"},
    "events": {"version": "0.1"},
    "entities": {"version": "0.1"},
    "vectors": {"version": "0.1"}
  },
  "profiles": {
    "sag-structured": {"version": "0.1"}
  }
}
```

没有声明时省略字段，不写空数组或布尔标记。

派生 Asset 可以在 `asset.derived_from` 保存直接来源：

```json
{
  "asset_id": "019c1234-5678-7abc-8def-0123456789ab",
  "version": "1.0.0",
  "package_digest": "sha256:..."
}
```

支持当前 OCTX 格式版本的消费者必须允许未知可选字段、读取已知字段，并在无损重写 Package 时保留未知字段。未知字段不能改变已知字段语义或单独满足 Capability / Profile。

这里的保留义务只适用于逻辑内容完全相同的无损重封装。创建新 Release 或 Derived Asset 时，旧工具不得把自己不理解的签名、证明或其他未知 manifest 字段自动带入新身份；这些字段必须由理解其语义的生产者重新生成或显式声明。

JSON object 中出现重复 key 属于校验错误。

## 6. Knowledge Documents

`knowledge/` 必须符合 [Google Open Knowledge Format v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)。

每篇非保留 Concept Document 必须：

- 是 UTF-8 Markdown。
- 具有可解析 YAML frontmatter。
- 具有非空 OKF `type`。
- 在 `octx` 命名空间中具有唯一 `document_id`。

```markdown
---
type: Reference
title: OCTX Overview
octx:
  document_id: 019c1234-5678-7abc-8def-0123456789ab
---

# OCTX Overview

正文。
```

`octx.document_id` 是规范小写 UUIDv7，在同一 Asset 的后续 Release 中保持稳定。移动或重命名文档不改变 ID；复制为新的独立文档时生成新 ID。

`index.md` 和 `log.md` 是 OKF 保留文件，不是 OCTX Knowledge Document，不要求 `octx.document_id`。它们仍必须遵守 OKF 对应结构。

路径继续承担 OKF 导航和 Markdown 链接语义；`document_id` 承担 OCTX 跨版本身份和派生记录引用。两者不能互相替代。

## 7. 标准 Capability 注册表

| Capability | 必需文件 | 依赖 |
| --- | --- | --- |
| `chunks/0.1` | `data/chunks.jsonl` | OCTX 格式 |
| `events/0.1` | `data/events.jsonl`, `relations/chunk-events.jsonl` | `chunks/0.1` |
| `entities/0.1` | `data/entities.jsonl`, `relations/event-entities.jsonl` | `events/0.1` |
| `vectors/0.1` | `vectors/config.json` 和至少一个标准 `.arrow` 文件 | 对应目标记录能力 |

relations 不是独立 Capability。标准路径出现时必须与对应 Capability 声明一致；生产者私有数据放入 `extensions/`，不能占用或重新解释标准路径。

每个 Package 中每类 v0.1 标准 JSONL 文件至多一份，不按文档拆分或分片。未来分片必须使用新的 Capability 版本。

## 8. 编码

- `manifest.json`、其他 JSON 和 JSONL 使用 UTF-8，不使用 BOM。
- JSONL 每个非空逻辑行必须是一个完整 JSON object；空行无效，文件末尾换行可选。
- Markdown 使用 UTF-8。生产者应不写 BOM；读取器必须接受一个位于文件开头的可选 UTF-8 BOM，并在 Markdown 和 YAML frontmatter 解析前移除它。
- YAML 必须使用安全解析模式，不执行自定义对象构造。YAML anchor 和 alias 均不允许，以避免别名展开造成资源放大。
- 向量使用 Apache Arrow IPC file format；具体 schema 由 vectors Capability 定义。

逐文件 SHA-256 对原始文件字节计算，因此换行、JSON 空白或字段顺序变化会产生新的文件摘要。消费者不能在验证前自动格式化 payload。

## 9. 身份

OCTX 为以下对象分配 UUIDv7：

- Asset
- Knowledge Document
- Chunk
- Event
- Entity

编码统一为小写、带连字符的 UUID 字符串，不加 `urn:uuid:`、花括号或类型前缀。Release 不另设 UUID，由 `asset.id + release.version + package_digest` 确认。

记录 ID 表示语义身份，摘要表示内容。不能用文本、名称或文件摘要替代记录 ID。

## 10. Package Digest

逐文件摘要与 Package Digest 分工如下：

- `files[].sha256` 定位并验证具体 payload 文件。
- `release.package_digest` 确认 manifest 语义与整棵规范 payload 清单。

计算步骤：

1. 重新计算并验证 `manifest.files` 中每个文件的 SHA-256。
2. 复制完整 manifest，移除 `release.package_digest`。
3. 按规范化 `path` 的 UTF-8 字节升序排列计算副本中的 `files`。
4. 使用 RFC 8785 JSON Canonicalization Scheme（JCS）编码整个计算副本。
5. 对结果计算 SHA-256，保存为 `sha256:<lowercase-hex>`。

文件字节不重复拼接进第 5 步，因为逐文件摘要已经提交其内容。ZIP 压缩方法、条目顺序、时间戳和安全但未列入清单的附加文件不影响 Package Digest。

声明摘要与计算结果不一致是不可绕过的完整性失败，不属于可确认的 Release 冲突。

## 11. 版本

OCTX 分别版本化：

- `format_version`：OCTX 格式版本，`major.minor`。
- Capability version：每项 Capability 独立的 `major.minor`。
- Profile version：每个 Profile 独立的 `major.minor`。
- `release.version`：知识资产内容版本，使用 SemVer。

在 `1.0` 发布前，`0.x` 的每个 minor 都可以调整必需行为或字段语义，消费者必须显式支持准确版本。进入 `1.x` 后，同一 major 的新 minor 只能增加可选内容或澄清语义，并保持向后兼容。

消费者行为：

- 支持 OCTX `0.1` 的消费者读取已知内容并保留未知可选字段。
- 未知 Capability 不阻止 OCTX 文档读取。
- Profile 依赖未知内容时不得宣称 Profile 有效。
- 不支持的 OCTX 格式版本必须明确拒绝，不能猜测解释。

## 12. 私有扩展

私有扩展路径为：

```text
extensions/<reverse-domain-namespace>/<major.minor>/...
```

例如：

```text
extensions/com.zleap.sag/1.0/data.jsonl
```

扩展文件必须列入 `manifest.files` 并参与 Package Digest。未知消费者可以忽略扩展语义，但无损 round-trip 时必须逐字节保留。私有扩展不能代替标准 Capability 或 Profile。

## 13. OCTX 校验结果

以下任一情况使 OCTX Package 无效：

- manifest 缺失、无法解析或缺少必填字段。
- `format` / `format_version` 不受支持。
- 没有任何 Concept Document。
- Concept frontmatter、`type` 或 `octx.document_id` 无效。
- Asset 或文档 ID 重复或编码不规范。
- 清单文件缺失、路径非法、逐文件摘要或 Package Digest 失配。
- ZIP 安全规则被违反。

OCTX Package 无效时不得安装为原 Asset。工具可以在用户明确选择后提取仍可读取的 Markdown，并使用新的 Asset 和文档身份创建派生资产。

## 14. 非目标

OCTX v0.1 不定义：

- 数据库快照或数据库主键。
- 增量同步、删除标记、实时更新或远程 payload。
- PDF、DOCX、图片、网页快照等转换前附件。
- 数字签名、发布者身份或可信根。
- 加密 ZIP。
- 搜索 API、召回算法、排序分数、Agent 协议或结果格式。
