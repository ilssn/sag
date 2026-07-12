# OCTX CLI

安装 `octx` 后会得到同名命令。CLI 与 Python API 使用同一套创建、读取、校验和安全边界。

## 命令一览

| 命令 | 作用 | 对应 Python API |
| --- | --- | --- |
| `octx create` | 创建 Package 或发布新 Release。 | [`create_octx()`](./create-octx.md) |
| `octx inspect` | 只读取 manifest 摘要，不做完整校验。 | [`open_octx()`](./open-octx.md) |
| `octx validate` | 完整校验并输出结果。 | [`validate_octx()`](./validate-octx.md) |
| `octx unpack` | 校验后安全展开。 | [`unpack_octx()`](./unpack-octx.md) |

## 创建

```bash
octx create ./.octx-workspace \
  --from ./knowledge \
  --name "Product Guide" \
  --output ./product-guide.octx
```

常用选项：

- `--version 1.1.0`：发布后续 Release。
- `--derive`：从展开的外部 Package 创建派生 Asset。
- `--capability NAME=VERSION`：可重复传入 Capability 声明。
- `--profile NAME=VERSION`：可重复传入 Profile 声明。
- `--from SOURCE` / `--in-place`：互斥的输入模式。
- `--yes`：非交互环境明确确认 `--in-place` 修改计划。

## 检查与校验

```bash
octx inspect ./product-guide.octx
octx validate ./product-guide.octx
```

`inspect` 只显示名称、Asset ID、Release、文件数和文档数，并明确标记没有执行 validation。不能用它替代 `validate`。

## 安全展开

```bash
octx unpack ./product-guide.octx ./product-guide-expanded
```

目标目录必须不存在或为空。命令只展开 manifest 和已声明 payload。

## JSON 输出

所有子命令都支持 `--json`：

```bash
octx validate ./product-guide.octx --json
```

JSON 模式适合 CI、Agent 和服务端调用。用法错误、OCTX 异常和校验报告都会输出稳定结构，不需要解析自然语言日志。

## 退出码

| 退出码 | 含义 |
| ---: | --- |
| `0` | 命令成功；`validate` 表示 Package 有效。 |
| `1` | `validate` 或发布前校验发现无效 Package。 |
| `2` | 命令用法、输入输出、确认或其他操作错误。 |
