import type { Metadata } from "next";
import { DocActions } from "@/components/doc-actions";
import { DocContent } from "@/components/doc-content";
import { DocsShell } from "@/components/docs-shell";
import { getAdjacentDocs, getDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Python API",
  description: "使用 OCTX Python API 与 CLI 创建、打开、校验和安全解包 Package。",
};

export default function ApiPage() {
  const doc = getDoc("python-api")!;
  const adjacent = getAdjacentDocs(doc.slug);

  return (
    <DocsShell currentHref={doc.href} section={doc.section} title={doc.title} headings={doc.headings} {...adjacent}>
      <article className="doc-article">
        <p className="doc-kicker">{doc.group}</p>
        <h1>{doc.title}</h1>
        <p className="doc-description">{doc.description}</p>
        <DocActions markdown={doc.content} />
        <DocContent markdown={doc.content} />
      </article>
    </DocsShell>
  );
}
