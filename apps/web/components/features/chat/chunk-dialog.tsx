"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

import { api, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ChunkRef {
  sourceId: string;
  chunkId: string;
  heading?: string;
  sourceName?: string | null;
}

/** 原文对话框 —— 引用 / 搜索结果的溯源终点：展示分块完整原文。 */
export function ChunkDialog({
  chunk,
  onOpenChange,
}: {
  chunk: ChunkRef | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!chunk) return;
    setContent(null);
    setError(null);
    api
      .getChunk(chunk.sourceId, chunk.chunkId)
      .then((c) => setContent(c.content))
      .catch((e) => setError(e instanceof ApiError ? e.message : "原文加载失败"));
  }, [chunk]);

  return (
    <Dialog open={chunk !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{chunk?.heading || "原文"}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>出自</span>
            {chunk && (
              <Link
                href={`/sources/${chunk.sourceId}`}
                className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2 hover:opacity-80"
                onClick={() => onOpenChange(false)}
              >
                {chunk.sourceName || "信源"}
                <ArrowUpRight className="size-3" />
              </Link>
            )}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : content === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner />
            载入原文…
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto overscroll-contain rounded-md border bg-muted/40 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
