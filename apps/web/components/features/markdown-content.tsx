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
            url: `citation:${match[1]}`,
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

export function MarkdownContent({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations?: Citation[];
  onCitationClick?: (citation: Citation) => void;
}) {
  const citationByNumber = React.useMemo(() => {
    return new Map((citations ?? []).map((c) => [String(c.n), c]));
  }, [citations]);
  const citationPlugin = React.useMemo(
    () => remarkCitationLinks(citationByNumber.size > 0),
    [citationByNumber],
  );

  return (
    <div className="answer-prose text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, citationPlugin]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith("citation:")) {
              const n = href.slice("citation:".length);
              const citation = citationByNumber.get(n);
              return (
                <button
                  type="button"
                  disabled={!citation}
                  onClick={() => citation && onCitationClick?.(citation)}
                  className={cn(
                    "mx-0.5 inline-grid size-4 -translate-y-[1px] place-items-center rounded-full text-[10px] font-medium leading-none align-baseline transition-colors",
                    citation
                      ? "bg-muted text-muted-foreground hover:bg-foreground/12 hover:text-foreground"
                      : "cursor-default bg-muted/60 text-muted-foreground/70",
                  )}
                  aria-label={citation ? `打开来源 ${n}` : `来源 ${n}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} {...props}>
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
}
