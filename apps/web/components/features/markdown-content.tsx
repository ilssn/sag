"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

type MdNode = {
  type?: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

function remarkCitationLinks(enabled: boolean) {
  return () => {
    if (!enabled) return;
    const visit = (node: MdNode) => {
      if (node.type === "link" || node.type === "code" || node.type === "inlineCode") return;
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          return [child];
        }

        const parts: MdNode[] = [];
        const re = /\[(\d+)\]/g;
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(child.value))) {
          if (match.index > last) {
            parts.push({ type: "text", value: child.value.slice(last, match.index) });
          }
          parts.push({
            type: "link",
            // Hash URLs survive react-markdown's URL sanitizer; the renderer below
            // replaces them with buttons, so citation clicks never navigate.
            url: `#citation-${match[1]}`,
            title: null,
            children: [{ type: "text", value: match[1] }],
            data: { hProperties: { "data-citation": match[1] } },
          });
          last = match.index + match[0].length;
        }
        if (!parts.length) return [child];
        if (last < child.value.length) {
          parts.push({ type: "text", value: child.value.slice(last) });
        }
        return parts;
      });
    };
    return visit;
  };
}

function MdImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [broken, setBroken] = React.useState(false);
  const src = typeof props.src === "string" ? props.src : "";
  const external = /^(https?:|data:|blob:)/.test(src);
  if (broken || !external) {
    return (
      <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        🖼 图片{props.alt ? `：${props.alt}` : ""}（见原文件）
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      {...props}
      alt={props.alt ?? "图片"}
      onError={() => setBroken(true)}
      className="my-2 max-h-80 max-w-full rounded-md border"
    />
  );
}

export const MarkdownContent = React.memo(function MarkdownContent({
  content,
  citations,
  onCitationClick,
  streaming = false,
}: {
  content: string;
  citations?: Citation[];
  onCitationClick?: (citation: Citation) => void;
  streaming?: boolean;
}) {
  const citationByNumber = React.useMemo(() => {
    return new Map((citations ?? []).map((c) => [String(c.n), c]));
  }, [citations]);
  const citationPlugin = React.useMemo(
    () => remarkCitationLinks(citationByNumber.size > 0),
    [citationByNumber],
  );

  return (
    <div
      className={cn("answer-prose text-foreground", streaming && "answer-prose--streaming")}
      aria-busy={streaming || undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, citationPlugin]}
        components={{
          img: MdImage,
          a: ({ href, children, ...props }) => {
            const citationMatch = href?.match(/^#citation-(\d+)$/);
            if (citationMatch) {
              const n = citationMatch[1];
              const citation = citationByNumber.get(n);
              return (
                <button
                  type="button"
                  disabled={!citation}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (citation) onCitationClick?.(citation);
                  }}
                  className={cn(
                    "relative -top-px mx-0.5 inline-flex size-[18px] items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold leading-none text-muted-foreground no-underline outline-none transition-colors align-baseline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    citation
                      ? "cursor-pointer hover:bg-muted-foreground/20 hover:text-foreground"
                      : "cursor-default opacity-60",
                  )}
                  aria-label={citation ? `打开来源 ${n}` : `来源 ${n}`}
                  title={citation?.heading || `来源 ${n}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
