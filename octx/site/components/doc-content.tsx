import { isValidElement, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { CodeBlock } from "@/components/code-block";

const DOC_LINKS: Record<string, string> = {
  "README.md": "/docs/introduction",
  "sag.md": "/docs/sag",
  "spec-v0.1.md": "/docs/specification",
  "sag-structured-v0.1.md": "/docs/sag-structured",
  "tooling-lifecycle.md": "/docs/tooling",
  "creating-octx.md": "/docs/creating-octx",
  "opening-validating-octx.md": "/docs/opening-validating-octx",
  "importing-octx.md": "/docs/importing-octx",
  "exporting-octx.md": "/docs/exporting-octx",
  "api/overview.md": "/api",
  "overview.md": "/api",
  "api/create-octx.md": "/api/create-octx",
  "create-octx.md": "/api/create-octx",
  "api/open-octx.md": "/api/open-octx",
  "open-octx.md": "/api/open-octx",
  "api/validate-octx.md": "/api/validate-octx",
  "validate-octx.md": "/api/validate-octx",
  "api/unpack-octx.md": "/api/unpack-octx",
  "unpack-octx.md": "/api/unpack-octx",
  "api/octx-package.md": "/api/octx-package",
  "octx-package.md": "/api/octx-package",
  "api/create-result.md": "/api/create-result",
  "create-result.md": "/api/create-result",
  "api/document.md": "/api/document",
  "document.md": "/api/document",
  "api/validation-report.md": "/api/validation-report",
  "validation-report.md": "/api/validation-report",
  "api/archive-limits.md": "/api/archive-limits",
  "archive-limits.md": "/api/archive-limits",
  "api/models-and-limits.md": "/api/models-and-limits",
  "models-and-limits.md": "/api/models-and-limits",
  "api/cli.md": "/api/cli",
  "cli.md": "/api/cli",
  "api/errors.md": "/api/errors",
  "errors.md": "/api/errors",
  "schemas/README.md": "/docs/schemas",
  "GLOSSARY.md": "/docs/glossary",
  "site/README.md": "/",
};

function mapHref(href?: string) {
  if (!href) return "#";
  if (href.startsWith("http") || href.startsWith("#") || href.startsWith("/")) return href;
  const normalized = href.replace(/^\.\//, "").replace(/^\.\.\//, "");
  if (DOC_LINKS[normalized]) return DOC_LINKS[normalized];
  if (/^(?:schemas\/)?0\.1\/[^/]+\.json$/.test(normalized)) {
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
        rehypePlugins={[rehypeSlug]}
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
