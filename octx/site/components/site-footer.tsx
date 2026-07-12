import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>OCTX</strong>
        <span>Open Context Asset Format</span>
      </div>
      <nav aria-label="页脚导航">
        <Link href="/docs/introduction">文档</Link>
        <Link href="/api">API</Link>
        <Link href="/docs/core">规范</Link>
        <a href="/schemas/1.0/manifest.schema.json">Schema</a>
        <a href="/llms.txt">llms.txt</a>
      </nav>
      <p>由 SAG 首先实现，为所有知识系统保持开放。</p>
    </footer>
  );
}
