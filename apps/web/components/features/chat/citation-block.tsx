"use client";

import * as React from "react";
import { BookOpenText, Quote } from "lucide-react";

import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChunkDialog, type ChunkRef } from "@/components/features/chat/chunk-dialog";

export const CitationBlock = React.memo(function CitationBlock({
  citations,
}: {
  citations: Citation[];
}) {
  const [open, setOpen] = React.useState(false);
  const [chunk, setChunk] = React.useState<ChunkRef | null>(null);
  if (!citations?.length) return null;

  return (
    <div className="mt-3 border-t pt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Quote className="size-3.5" />
        来源 · {citations.length}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {citations.map((c) => {
            const traceable = Boolean(c.chunk_id && c.source_id);
            const Card: React.ElementType = traceable ? "button" : "div";
            return (
              <Card
                key={c.n}
                {...(traceable
                  ? {
                      type: "button",
                      onClick: () =>
                        setChunk({
                          sourceId: c.source_id!,
                          chunkId: c.chunk_id!,
                          heading: c.heading,
                          sourceName: c.source_name,
                        }),
                      title: "查看原文",
                    }
                  : {})}
                className={cn(
                  "group/cite flex w-full gap-2.5 rounded-md border bg-muted/50 p-2.5 text-left text-xs",
                  traceable && "cursor-pointer transition-colors hover:border-border",
                )}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded bg-muted font-mono text-[11px] font-semibold text-foreground">
                  {c.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {c.heading && <span className="font-medium text-foreground">{c.heading}</span>}
                    {c.source_name && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {c.source_name}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-3 block text-muted-foreground">{c.snippet}</span>
                </span>
                {traceable && (
                  <BookOpenText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/cite:opacity-100" />
                )}
              </Card>
            );
          })}
        </div>
      )}
      <ChunkDialog chunk={chunk} onOpenChange={(o) => !o && setChunk(null)} />
    </div>
  );
});
