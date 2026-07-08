"use client";

import * as React from "react";
import { FlaskConical, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Section } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RetrievalTestDialog({
  sourceId,
  sourceName,
  open,
  onOpenChange,
}: {
  sourceId: string;
  sourceName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [topK, setTopK] = React.useState(8);
  const [results, setResults] = React.useState<Section[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setResults(null);
    setQuery("");
  }, [open]);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = await api.globalSearch({ query, source_ids: [sourceId], top_k: topK });
      setResults(r.sections);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "检索失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-gold-strong" />
            检索测试 · {sourceName}
          </DialogTitle>
          <DialogDescription>
            用真实查询验证召回效果——所见即所得，先看看能捞回哪些片段。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={run} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="rt-q">查询</Label>
            <Input
              id="rt-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入一个真实问题，看看能召回什么"
              autoFocus
            />
          </div>
          <div className="flex w-20 flex-col gap-1.5">
            <Label htmlFor="rt-k">top_k</Label>
            <Input
              id="rt-k"
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </div>
          <Button type="submit" variant="gold" disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            检索
          </Button>
        </form>

        {results && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-ink-faint">
              <span>召回 {results.length} 条</span>
            </div>

            <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-hairline">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-ink-faint">
                  没有召回任何内容。换个说法，或确认文档已处理完成。
                </p>
              ) : (
                results.map((s, i) => (
                  <div key={`${s.chunk_id}-${i}`} className="border-t border-hairline p-3 first:border-t-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-gold-soft text-[11px] font-semibold text-gold-strong">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {s.heading || "片段"}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                        {s.score.toFixed(4)}
                      </span>
                    </div>
                    {/* 分数条：直观对比召回强弱 */}
                    <div className="mb-1.5 ml-7 h-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-gold"
                        style={{ width: `${Math.max(4, Math.min(100, s.score * 100))}%` }}
                      />
                    </div>
                    <p className="ml-7 line-clamp-2 text-xs text-ink-muted">{s.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
