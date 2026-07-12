# OCTX 工具链概览

> 状态：v0.1 设计基线。本文说明参考工具、知识系统适配层及 Asset、Release、Package、Installation 的职责边界。

## 分层

```text
独立 octx 包
  -> create_octx
  -> open_octx
  -> validate_octx
  -> CLI create / inspect / validate / unpack

知识系统适配层
  -> 导入和导出 .octx
  -> 生成缺失结构
  -> 物化本地索引

知识库应用
  -> 预览、确认、安装、升级、回滚和资产管理 UI
```

`octx` 不依赖 SAG 数据库或其他特定知识系统。以 SAG 为例，`zleap-sag` 依赖并重新导出通用 OCTX 入口，同时实现 `.octx` 与 SAG 之间的导入和导出适配。其他知识系统可以实现自己的适配层。

## 领域对象

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

## 工作流文档

- [创建 OCTX](creating-octx.md)：首次创建、派生资产和 Release 版本保护。
- [打开与校验](opening-validating-octx.md)：安全读取、完整校验和错误报告。
- [导入与安装](importing-octx.md)：以 SAG 为例说明导入、升级、冲突、索引和重建。
- [导出与配置](exporting-octx.md)：以 SAG 为例说明导出和本地配置边界。
