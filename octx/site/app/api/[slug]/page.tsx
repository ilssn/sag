import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocActions } from "@/components/doc-actions";
import { DocContent } from "@/components/doc-content";
import { DocsShell } from "@/components/docs-shell";
import { getAdjacentDocs, getAllDocs, getDoc } from "@/lib/docs";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllDocs()
    .filter((doc) => doc.section === "api" && doc.href !== "/api")
    .map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc || doc.section !== "api") return {};
  return { title: doc.title, description: doc.description };
}

export default async function ApiDocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc || doc.section !== "api" || doc.href === "/api") notFound();
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
