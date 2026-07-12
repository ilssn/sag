# `Document`

`Document` 是从 OCTX Package 读取一篇知识文档时得到的不可变视图。它同时保留解析后的 Markdown 内容和 manifest 摘要对应的原始字节。

## 获取对象

[`OctxPackage.iter_documents()`](./octx-package.md) 按 Package 路径顺序产生 `Document`：

```python
from octx import open_octx

with open_octx("product-guide.octx") as package:
    for document in package.iter_documents():
        print(document.path, document.metadata.get("title"))
```

## 字段

| 字段 | 作用 |
| --- | --- |
| `path` | Package 内的 Markdown 路径。 |
| `metadata` | 只读 YAML frontmatter 映射。 |
| `body` | 去掉 frontmatter 和可选 UTF-8 BOM 后的 Markdown。 |
| `raw` | manifest 摘要对应的原始字节。 |

## 读取边界

`Document` 只负责读取，不会把修改写回 Package。需要保留原始内容或重新计算摘要时使用 `raw`；需要展示、检索或解析正文时使用 `body` 和 `metadata`。
