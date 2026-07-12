"use client";

import * as React from "react";
import { BookOpenText, ChevronDown } from "lucide-react";

import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDetailPanel } from "@/components/features/detail-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function sourceKey(citation: Citation): string {
  return citation.source_id || citation.source_name || `citation-${citation.n}`;
}

/** 常驻的紧凑来源入口；默认打开全局详情，紧凑容器可接管为原位详情。 */
export const CitationBlock = React.memo(function CitationBlock({
  citations,
  onCitationClick,
}: {
  citations: Citation[];
  onCitationClick?: (citation: Citation) => void;
}) {
  const panel = useDetailPanel();
  if (!citations?.length) return null;

  const sourceCount = new Set(citations.map(sourceKey)).size;
  const referenceCount = citations.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted/70 px-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${sourceCount} 个来源，${referenceCount} 条引用`}
        >
          <BookOpenText className="size-3" />
          <span>{sourceCount} 个来源</span>
          {referenceCount !== sourceCount && (
            <span className="font-normal text-muted-foreground/70">· {referenceCount} 条引用</span>
          )}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] p-1.5"
      >
        <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5">
          <span>参考来源</span>
          <span className="font-normal tabular-nums text-muted-foreground/70">
            {referenceCount} 条引用
          </span>
        </DropdownMenuLabel>
        {citations.map((citation) => {
          const traceable = Boolean(citation.chunk_id && citation.source_id);
          return (
            <DropdownMenuItem
              key={citation.n}
              disabled={!traceable}
              onSelect={() => {
                if (!citation.chunk_id || !citation.source_id) return;
                if (onCitationClick) {
                  onCitationClick(citation);
                  return;
                }
                panel.open({
                  kind: "chunk",
                  sourceId: citation.source_id,
                  chunkId: citation.chunk_id,
                  heading: citation.heading ?? undefined,
                  sourceName: citation.source_name ?? undefined,
                });
              }}
              className="group/cite items-start gap-2.5 px-2 py-2.5"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
                {citation.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {citation.heading || "资料片段"}
                  </span>
                  {citation.source_name && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {citation.source_name}
                    </span>
                  )}
                </span>
                {citation.snippet && (
                  <span className="mt-0.5 block max-h-8 overflow-hidden text-[11px] leading-4 text-muted-foreground">
                    {citation.snippet}
                  </span>
                )}
              </span>
              <BookOpenText
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity",
                  traceable && "group-hover/cite:opacity-100",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
