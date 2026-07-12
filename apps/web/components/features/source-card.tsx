"use client";

import Link from "next/link";
import * as React from "react";
import { FileText, Network, Puzzle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditSourceDialog } from "@/components/features/edit-source-dialog";
import { useApp } from "@/components/features/app-shell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SourceCard({ source, onChanged }: { source: Source; onChanged?: () => void }) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const { timezone } = useApp();

  async function deleteSource() {
    try {
      await api.deleteSource(source.id);
      toast.success("信源已删除");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  return (
    <div className="group/source relative">
      <Link
        href={`/knowledge/${source.id}`}
        className="block rounded-lg border bg-card p-5 shadow-soft transition-all duration-150 ease-smooth hover:border-foreground/15 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3 pr-20">
          <h3 className="font-display text-lg font-medium leading-tight text-foreground">
            {source.name}
          </h3>
        </div>
        <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {source.description || "暂无描述"}
        </p>
        <div className="mt-4 flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
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
          <span className="ml-auto">{relativeTime(source.updated_at, timezone)}</span>
        </div>
      </Link>

      <div className="absolute right-5 top-5 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/source:opacity-100 group-focus-within/source:opacity-100">
        <EditSourceDialog
          source={source}
          onUpdated={onChanged}
          tooltipSide="bottom"
          buttonClassName="bg-background/95 shadow-soft backdrop-blur-sm"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除信源"
              title="删除信源"
              onClick={() => setConfirmDelete(true)}
              className="bg-background/95 text-muted-foreground shadow-soft backdrop-blur-sm hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">删除信源</TooltipContent>
        </Tooltip>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除信源"
        description={`「${source.name}」及其文档、会话将被删除，检索数据不可再访问。此操作无法撤销。`}
        confirmLabel="删除信源"
        onConfirm={deleteSource}
      />
    </div>
  );
}
