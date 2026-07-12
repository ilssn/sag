# Open Context Python API

`octx` 是 Open Context 的独立 Python 参考实现。它负责创建、打开、校验和安全解包 `.octx` Package，不依赖 SAG、数据库或检索后端。

## 安装

需要 Python 3.11 或更高版本：

```bash
python -m pip install octx
```

读取或校验 Arrow 向量文件时安装 `vectors` extra：

```bash
python -m pip install "octx[vectors]"
```

## 公开入口

| API | 用途 |
| --- | --- |
| [`create_octx()`](./create-octx.md) | 从 Markdown 或已有 workspace 创建不可变 `.octx` Package，或发布后续 Release。 |
| [`open_octx()`](./open-octx.md) | 安全打开 ZIP 或展开目录，得到只读 `OctxPackage`，但不执行完整规范校验。 |
| [`validate_octx()`](./validate-octx.md) | 完整校验 Core、已知 Capability 与 Profile，返回结构化报告。 |
| [`unpack_octx()`](./unpack-octx.md) | 校验通过后，将 manifest 和已声明 payload 安全展开到目录。 |
| [`OctxPackage`](./octx-package.md) | 读取 manifest、Markdown、JSONL 结构层和 Arrow 向量。 |
| [数据模型与资源限制](./models-and-limits.md) | `CreateResult`、`ValidationReport`、`Document`、`ArchiveLimits` 等类型。 |
| [CLI](./cli.md) | `octx create / inspect / validate / unpack` 命令。 |
| [错误处理](./errors.md) | 公开异常、错误码和推荐处理方式。 |

## 最小流程

假设 `knowledge/` 中至少有一篇 Markdown：

```python
from octx import create_octx, open_octx, validate_octx

result = create_octx(
    "./.octx-workspace",
    source="./knowledge",
    name="Product Guide",
    output="./product-guide.octx",
)

report = validate_octx(result.output)
assert report.valid
assert report.fully_validated

with open_octx(result.output) as package:
    for document in package.iter_documents():
        print(document.path, document.metadata["title"])
```

`source` 不会被修改。`workspace` 保存稳定的 Asset、Document 和 Release 身份；后续发布同一资产时应继续使用同一个 workspace。

## 调用顺序

处理自己刚创建的 Package 时，可以直接使用 `CreateResult.report`。处理外部或不可信 Package 时，推荐顺序是：

1. 用 `validate_octx()` 得到不会因普通格式错误而中断流程的结构化报告。
2. 同时检查 `report.valid` 和 `report.fully_validated`。
3. 校验满足接收策略后，再用 `open_octx()` 读取，或用 `unpack_octx()` 展开。

`open_octx()` 成功只表示容器可以安全打开，不表示全部内容已经通过 OCTX 规范校验。
