# Open Context

Open Context（简称 OCTX）是一种建立在 Google Open Knowledge Format（OKF）之上的开放上下文标准。它把可读 Markdown、稳定身份、版本、完整性信息及可选的 chunks、events、entities、关系和向量封装为可传播的 `.octx` Package。

Open Context 由 SAG 首先实现，但规范和参考工具不依赖 SAG、`zleap-sag`、特定数据库或向量后端。

## 阅读顺序

1. **OCTX v0.1 规范**（`spec-v0.1.md`）：容器、manifest、知识文档、身份、摘要、版本和扩展规则。
2. **SAG-structured v0.1 Profile**（`sag-structured-v0.1.md`）：chunks、events、entities、关系、向量和完整覆盖约束。
3. **工具与生命周期**（`tooling-lifecycle.md`）：create/open/validate/import/export、Asset/Release/Installation 和冲突处理。
4. **Python API**（`api/overview.md`）：按功能拆分的创建、读取、校验、安全解包和 CLI 文档。
5. **机器可读 Schema**（`schemas/README.md`）：JSON Schema Draft 2020-12 与语义校验边界。
6. **领域词汇表**（`GLOSSARY.md`）：OCTX、SAG 和 zleap-sag 的统一术语。

## Python 快速开始

需要 Python 3.11 或更高版本：

```bash
python -m pip install octx
```

从 Markdown 目录创建 Package，然后打开并校验：

```python
from octx import create_octx, open_octx, validate_octx

result = create_octx(
    "./.octx-workspace",
    source="./knowledge",
    name="Product Guide",
    output="./product-guide.octx",
)

with open_octx(result.output) as package:
    for document in package.iter_documents():
        print(document.path, document.metadata["title"])

report = validate_octx(result.output)
assert report.valid
```

`source` 不会被修改。持续使用同一个 workspace，可以保留 Asset、Document 和 Release 的稳定身份。向量读取需要安装 `octx[vectors]`。完整接口见 `api/overview.md`。

展开的外部 Package 未修改时可以无损重新封装；修改或增强后，使用 `create_octx(..., derive=True)` 创建带 `asset.derived_from` 的新 Asset，避免冒充原发布者的后续版本。

## CLI 快速开始

```bash
octx create ./.octx-workspace --from ./knowledge --name "Product Guide" -o ./product-guide.octx
octx inspect ./product-guide.octx
octx validate ./product-guide.octx
octx unpack ./product-guide.octx ./product-guide-expanded
```

`inspect` 只读取摘要，不代替完整校验。`validate` 有效时退出 `0`，无效时退出 `1`；所有命令都支持 `--json`。

## 官网与文档站

官网域名是 [open-context.ai](https://open-context.ai)。独立网站源码位于 `site/`，直接发布本目录中的完整规范、Python API、Schema 和词汇表，不依赖 SAG 项目的应用代码。

## v0.1 要点

- 发布文件扩展名是 `.octx`，外层使用 ZIP / ZIP64。
- 每个 Package 至少包含一篇 OKF Concept Markdown。
- OKF 是 OCTX 的知识内容子集；OCTX 增加资产身份、Release、摘要和可选派生数据。
- OCTX Package 可以只有 Markdown，不要求预先生成 chunks、events、entities 或 vectors。
- `sag-structured/0.1` 是显式 Profile，不能根据文件存在情况自动推断。
- `.octx` 是不可变完整快照，不是数据库备份、增量包或同步协议。
- OCTX 不定义搜索 API、召回算法、Agent 协议或向量数据库。

## 参考实现边界

独立 `octx` 包提供：

- `create_octx()`
- `open_octx()`
- `validate_octx()`
- `unpack_octx()`
- `octx create / inspect / validate / unpack`

`zleap-sag` 依赖并重新导出这些入口，同时增加：

- `import_octx()`
- `export_octx()`

其他知识系统可以直接使用 `octx` 并实现自己的适配层。
