import { isValidElement, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { CodeBlock } from "@/components/code-block";

const DOC_LINKS: Record<string, string> = {
  "README.md": "/docs/introduction",
  "spec-v1.md": "/docs/core",
  "sag-structured-v1.md": "/docs/sag-structured",
  "tooling-lifecycle.md": "/docs/tooling",
  "python-api.md": "/api",
  "schemas/README.md": "/docs/schemas",
  "GLOSSARY.md": "/docs/glossary",
  "site/README.md": "/",
};

function mapHref(href?: string) {
  if (!href) return "#";
  if (href.startsWith("http") || href.startsWith("#") || href.startsWith("/")) return href;
  const normalized = href.replace(/^\.\//, "").replace(/^\.\.\//, "");
  if (DOC_LINKS[normalized]) return DOC_LINKS[normalized];
  if (/^(?:schemas\/)?1\.0\/[^/]+\.json$/.test(normalized)) {
    return `/schemas/${normalized.replace(/^schemas\//, "")}`;
  }
  return href;
}

function codeText(children: ReactNode) {
  if (!isValidElement<{ children?: ReactNode; className?: string }>(children)) {
    return { text: String(children ?? ""), language: undefined };
  }
  const raw = String(children.props.children ?? "").replace(/\n$/, "");
  const language = children.props.className?.replace("language-", "");
  return { text: raw, language };
}

export function DocContent({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "append",
              properties: { className: ["heading-anchor"], "aria-label": "本节链接" },
              content: { type: "text", value: "#" },
            },
          ],
        ]}
        components={{
          pre({ children }) {
            const { text, language } = codeText(children);
            return <CodeBlock code={text} language={language} />;
          },
          code({ children, className }) {
            return <code className={className}>{children}</code>;
          },
          a({ href, children }) {
            const mapped = mapHref(href);
            const external = mapped.startsWith("http");
            if (external) {
              return (
                <a href={mapped} target="_blank" rel="noreferrer">
                  {children}
                  <ExternalLink className="inline-external" size={13} aria-hidden="true" />
                </a>
              );
            }
            return <Link href={mapped}>{children}</Link>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
