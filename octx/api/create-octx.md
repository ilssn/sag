# `create_octx()`

`create_octx()` 创建不可变 `.octx` Package。它负责维护 Asset、Document 和 Release 身份，生成 manifest 与摘要，写入临时归档，完整校验后再发布到 `output`。

## 函数签名

```python
def create_octx(
    workspace: os.PathLike[str] | str,
    *,
    output: os.PathLike[str] | str,
    source: os.PathLike[str] | str | None = None,
    name: str | None = None,
    version: str | None = None,
    in_place: bool = False,
    confirm_in_place: bool = False,
    derive: bool = False,
    capabilities: Mapping[str, str | Mapping[str, Any]] | None = None,
    profiles: Mapping[str, str | Mapping[str, Any]] | None = None,
    limits: ArchiveLimits | None = None,
) -> CreateResult
```

## 参数

| 参数 | 作用 |
| --- | --- |
| `workspace` | 可重复使用的生产目录，保存 `knowledge/`、`manifest.json` 和本地 `.octx/state.json`。 |
| `output` | 要发布的 `.octx` 文件。已有不同内容时不会覆盖。 |
| `source` | 复制进 workspace 的 Markdown 目录；原目录不会被修改。与 `in_place` 互斥。 |
| `name` | 首次创建 Asset 时必填；后续默认复用已保存名称。 |
| `version` | Release 的 SemVer。首次默认 `1.0.0`；内容改变后必须提高版本。 |
| `in_place` | 将 workspace 根目录中的 Markdown 整理进 `knowledge/`。 |
| `confirm_in_place` | 明确确认 `in_place` 将执行的移动和 frontmatter 补全。 |
| `derive` | 从展开的外部 Package 创建新 Asset，并记录 `asset.derived_from`。 |
| `capabilities` | 显式声明能力，例如 `{"chunks": "1.0"}`；不会根据文件自动推断。 |
| `profiles` | 显式声明 Profile，例如 `{"sag-structured": "1.0"}`。 |
| `limits` | 创建和校验期间使用的资源上限。 |

## 首次创建

```python
from octx import create_octx

result = create_octx(
    "./.octx-workspace",
    source="./knowledge",
    name="Product Guide",
    output="./product-guide.octx",
)

print(result.asset_id)
print(result.version)          # 1.0.0
print(result.package_digest)
```

首次成功创建后，workspace 中的本地状态会记录稳定 Asset ID 和 Document ID。不要为同一资产的每个版本重新建立 workspace。

## 发布后续 Release

修改 workspace 内容后，提高版本并指定新的输出文件：

```python
result = create_octx(
    "./.octx-workspace",
    version="1.1.0",
    output="./product-guide-1.1.0.octx",
)
```

同一逻辑内容可以按同一版本稳定重建；同一 Asset 和版本出现不同 Package Digest 时会拒绝发布。版本回退或内容变化但版本未提高时抛出 `ReleaseVersionError`。

## 声明 SAG-structured

声明 Capability 或 Profile 不会自动生成数据。对应 JSONL、关系和向量文件必须已经存在于 workspace，并满足完整覆盖约束。

```python
result = create_octx(
    "./.octx-workspace",
    version="2.0.0",
    output="./product-guide-2.0.0.octx",
    capabilities={
        "chunks": "1.0",
        "events": "1.0",
        "entities": "1.0",
        "vectors": "1.0",
    },
    profiles={"sag-structured": "1.0"},
)
```

## 外部 Package 与派生

对没有本地 producer state 的展开 Package：

- 内容未变化时，可以无损重封装，保留原 Asset ID、版本、Package Digest 和未知字段。
- 内容发生变化时，必须传 `derive=True` 创建新 Asset，不能冒充原发布者的后续 Release。

```python
derived = create_octx(
    "./external-expanded",
    derive=True,
    output="./derived.octx",
)
```

派生结果使用新的 `asset_id`，首个 Release 默认从 `1.0.0` 开始，并记录直接来源的 Asset ID、版本和 Package Digest。

## 返回值

返回 [`CreateResult`](./models-and-limits.md)，包含输出路径、workspace、Asset ID、Release 版本、创建时间、Package Digest、Document ID 映射和完整 `ValidationReport`。

创建失败时不会发布半成品到 `output`。常见异常包括 `ReleaseVersionError`、`DerivationRequired`、`OutputExistsError`、`ConfirmationRequired` 和 `OctxValidationError`。
