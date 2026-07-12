# 创建 OCTX

> 状态：v0.1 设计基线。本文定义首次创建、后续 Release 和 Derived Asset 的行为。

## 公共入口

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

首次身份建立和 Release 打包是内部阶段，不要求调用者组合 `init + pack` 两个函数。完整参数见 [`create_octx()` API](api/create-octx.md)。

## 首次创建

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

如果普通 Markdown 来源中恰好存在不符合 OKF 导航或日志结构的 `index.md` 或 `log.md`，create 必须提示其为保留文件并要求用户重命名或修正，不能静默把它当作 Concept Document，也不能擅自改名破坏链接。

`--in-place` 允许改造原目录。工具必须先显示将移动和修改的文件，并由用户明确选择；它不能成为默认路径。

目标已经存在 Asset 身份时，create 必须复用，不能重新初始化或覆盖 ID。

展开的外部 Package 没有本地 producer state。内容未变化时，create 可以无损重新封装同一逻辑 Package，但不能借此续发原 Asset；内容发生修改或增强时，必须显式 `--derive`，生成新的 Asset ID，并把原 Package 三元组写入 `asset.derived_from`。

无损重封装逐字保留未知 manifest 字段。新 Release 和 Derived Asset 则重新生成当前工具理解的 OCTX manifest、Release 与文件清单，不继承来源中的未知签名、证明或文件级断言；需要这些字段时，必须交给理解其语义的生产者重新声明。

## Release 版本保护

- 首个 Release 未指定版本时使用 `1.0.0`。
- 相同内容可以重建同一版本 Package，Package Digest 保持不变。
- 内容或参与摘要的 manifest 信息变化时，必须使用更高 SemVer。
- 参考 create 工具不提供生成“同 Asset、同版本、不同摘要”的普通强制参数。
- 构建先写临时文件，完整验证成功后再原子替换目标输出。
- 如果发布输出已经落盘、但本地状态仍停留在 `building`，下次创建仍以 workspace 中已发布 manifest 的版本与摘要作为不可变基线，不允许复用同一版本发布不同内容。
