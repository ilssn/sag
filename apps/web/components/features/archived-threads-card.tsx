"use client";

import * as React from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Thread } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 归档会话 —— 恢复或彻底删除。 */
export function ArchivedThreadsCard() {
  const { agent, refreshThreads } = useApp();
  const [rows, setRows] = React.useState<Thread[] | null>(null);

  const load = React.useCallback(async () => {
    if (!agent) return;
    try {
      setRows(await api.listThreads(agent.id, { archived: true }));
    } catch {
      setRows([]);
    }
  }, [agent]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function restore(t: Thread) {
    if (!agent) return;
    try {
      await api.updateThread(agent.id, t.id, { archived: false });
      await Promise.all([load(), refreshThreads()]);
      toast.success("已恢复到会话列表");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "恢复失败");
    }
  }

  async function remove(t: Thread) {
    if (!agent) return;
    try {
      await api.deleteThread(agent.id, t.id);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>归档会话</CardTitle>
        <CardDescription>归档不删除内容；可随时恢复，或在此彻底删除。</CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有归档的会话。</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {rows.map((t, i) => (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm ${i > 0 ? "border-t" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {relativeTime(t.updated_at)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => restore(t)}
                      aria-label="恢复会话"
                    >
                      <ArchiveRestore />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>恢复</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(t)}
                      aria-label="彻底删除"
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>彻底删除</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
