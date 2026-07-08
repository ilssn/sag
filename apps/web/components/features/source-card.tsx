import Link from "next/link";
import { FileText, Network, Puzzle } from "lucide-react";

import type { Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";

export function SourceCard({ source }: { source: Source }) {
  return (
    <Link
      href={`/sources/${source.id}`}
      className="group flex flex-col rounded-lg border border-hairline bg-surface p-5 shadow-soft transition-all duration-150 ease-smooth hover:border-foreground/15 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-medium leading-tight text-ink group-hover:text-gold-strong">
          {source.name}
        </h3>
      </div>
      <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-ink-muted">
        {source.description || "暂无描述"}
      </p>
      <div className="mt-4 flex items-center gap-4 border-t border-hairline pt-3 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" />
          {source.document_count} 文档
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Puzzle className="size-3.5" />
          {source.chunk_count} 块
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Network className="size-3.5" />
          {source.event_count} 事件
        </span>
        <span className="ml-auto">{relativeTime(source.updated_at)}</span>
      </div>
    </Link>
  );
}
