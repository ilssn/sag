import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="not-found" id="main-content">
      <p>404</p>
      <h1>这份上下文还不存在。</h1>
      <span>页面可能已经移动，或者尚未成为 OCTX 文档的一部分。</span>
      <Link className="secondary-button" href="/docs/introduction">
        <ArrowLeft size={17} aria-hidden="true" /> 返回文档
      </Link>
    </main>
  );
}
