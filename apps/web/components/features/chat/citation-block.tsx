"use client";

import * as React from "react";
import { Quote } from "lucide-react";

import type { Citation } from "@/lib/types";

export const CitationBlock = React.memo(function CitationBlock({
  citations,
}: {
  citations: Citation[];
}) {
  const [open, setOpen] = React.useState(false);
  if (!citations?.length) return null;
  return (
    <div className="mt-3 border-t border-hairline pt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-gold-strong"
      >
        <Quote className="size-3.5" />
        来源 · {citations.length}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {citations.map((c) => (
            <div
              key={c.n}
              className="flex gap-2.5 rounded-md border border-hairline bg-surface-2/50 p-2.5 text-xs"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded bg-gold-soft font-mono text-[11px] font-semibold text-gold-strong">
                {c.n}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.heading && <span className="font-medium text-ink">{c.heading}</span>}
                  {c.source_name && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
                      {c.source_name}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 line-clamp-3 text-ink-muted">{c.snippet}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
