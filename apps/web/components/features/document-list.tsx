"use client";

import * as React from "react";
import { FileText, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Doc } from "@/lib/types";
import { formatBytes, relativeTime } from "@/lib/format";
import { useDetailPanel } from "@/components/features/detail-panel";
import { DocStatusBadge } from "@/components/features/status-badge";
import { Button } from "@/components/ui/button";

export function DocumentList({
  sourceId,
  documents,
  onChange,
}: {
  sourceId: string;
  documents: Doc[];
  onChange: () => void;
}) {
  const [pending, setPending] = React.useState<string | null>(null);
  const { open } = useDetailPanel();

  async function reprocess(d: Doc) {
    setPending(d.id);
    try {
      await api.reprocessDocument(sourceId, d.id);
      toast.success("已重新加入处理队列");
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setPending(null);
    }
  }

  async function remove(d: Doc) {
    setPending(d.id);
    try {
      await api.deleteDocument(sourceId, d.id);
      toast.success("文档已删除");
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {documents.map((d, i) => (
        <div
          key={d.id}
          className={
            "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 " +
            (i > 0 ? "border-t" : "")
          }
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </div>

          <button
            type="button"
            onClick={() => open({ kind: "document", sourceId, documentId: d.id })}
            className="min-w-0 flex-1 text-left outline-none focus-visible:underline"
            title="查看详情与原文预览"
          >
            <div className="truncate text-sm font-medium text-foreground">{d.filename}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatBytes(d.size_bytes)}</span>
              <span>·</span>
              <span>{relativeTime(d.created_at)}</span>
              {d.status === "ready" && (
                <>
                  <span>·</span>
                  <span>
                    {d.chunk_count} 块 / {d.event_count} 事件
                  </span>
                </>
              )}
              {d.status === "failed" && d.error && (
                <>
                  <span>·</span>
                  <span className="truncate text-destructive" title={d.error}>
                    {d.error}
                  </span>
                </>
              )}
            </div>
          </button>

          <DocStatusBadge status={d.status} />

          <div className="flex shrink-0 items-center gap-0.5">
            {(d.status === "failed" || d.status === "ready") && (
              <Button
                variant="ghost"
                size="icon"
                title="重新处理"
                disabled={pending === d.id}
                onClick={() => reprocess(d)}
              >
                <RefreshCw className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="删除"
              disabled={pending === d.id}
              onClick={() => remove(d)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
