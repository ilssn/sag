# Open Context Website

Open Context（简称 OCTX）的独立官网与完整文档站，正式域名为 [open-context.ai](https://open-context.ai)。网站不依赖 SAG 应用，只在构建时读取上一级 `octx/` 目录中的公开规范、分页面 Python API、Schema 和词汇表。

## 本地运行

```bash
npm install
npm run dev
```

默认地址是 <http://localhost:3000>。

## 构建静态站点

```bash
npm run typecheck
npm run build
```

静态产物写入 `out/`。构建前会自动把 JSON Schema 同步到 `public/schemas/0.1/`，并生成 `llms.txt` 与 `llms-full.txt`。
