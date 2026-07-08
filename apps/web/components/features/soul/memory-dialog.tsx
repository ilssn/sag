"use client";

import * as React from "react";
import { Brain, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { MemoryStats } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-hairline bg-surface-2/50 py-3">
      <span className="font-display text-2xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-xs text-ink-faint">{label}</span>
    </div>
  );
}

export function MemoryDialog({
  soulId,
  canManage,
  open,
  onOpenChange,
  onCleared,
}: {
  soulId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCleared?: () => void;
}) {
  const [stats, setStats] = React.useState<MemoryStats | null>(null);
  const [confirm, setConfirm] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStats(null);
    api
      .getMemory(soulId)
      .then(setStats)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "无法加载记忆"));
  }, [open, soulId]);

  async function clear() {
    try {
      const r = await api.clearMemory(soulId);
      toast.success(r.detail);
      setStats({ document_count: 0, chunk_count: 0, event_count: 0, recent: [] });
      onCleared?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "清空失败");
    } finally {
      setConfirm(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-4 text-gold-strong" />
            记忆
          </DialogTitle>
          <DialogDescription>
            每轮对话都会沉淀为这个助手的记忆，越聊越懂你。记忆同样参与后续检索与作答。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="对话条数" value={stats?.document_count ?? 0} />
          <Stat label="记忆分块" value={stats?.chunk_count ?? 0} />
          <Stat label="抽取事件" value={stats?.event_count ?? 0} />
        </div>

        {stats && stats.recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">最近沉淀</span>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-hairline">
              {stats.recent.map((r, i) => (
                <div
                  key={r.id}
                  className={
                    "flex items-center justify-between px-3 py-2 text-sm" +
                    (i > 0 ? " border-t border-hairline" : "")
                  }
                >
                  <span className="text-ink-muted">对话记忆</span>
                  <span className="text-xs text-ink-faint">{relativeTime(r.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats && stats.document_count === 0 && (
          <p className="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-sm text-ink-faint">
            还没有记忆。开始对话后，这里会逐渐充盈。
          </p>
        )}

        {canManage && stats && stats.document_count > 0 && (
          <div className="flex justify-end border-t border-hairline pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm(true)}
              className="text-danger hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-3.5" />
              清空记忆
            </Button>
          </div>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="清空记忆？"
        description="该助手积累的全部对话记忆将被永久删除，无法恢复。绑定的信源不受影响。"
        confirmLabel="清空记忆"
        onConfirm={clear}
      />
    </Dialog>
  );
}
