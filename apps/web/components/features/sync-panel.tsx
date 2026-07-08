"use client";

import * as React from "react";
import { Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function SyncPanel({ sourceId, onSynced }: { sourceId: string; onSynced: () => void }) {
  const [busy, setBusy] = React.useState(false);

  async function sync() {
    setBusy(true);
    try {
      await api.syncSource(sourceId);
      toast.success("已开始同步，sag 正在后台抓取网页");
      onSynced();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-hairline bg-surface/40 p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-full bg-surface-2 text-gold-strong">
          <Globe className="size-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-ink">网页同步</div>
          <p className="mt-0.5 text-xs text-ink-muted">
            抓取信源配置的网页正文，解析入库并抽取事件。可随时重新同步以获取更新。
          </p>
        </div>
      </div>
      <Button variant="gold" onClick={sync} disabled={busy}>
        <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        {busy ? "同步中…" : "同步"}
      </Button>
    </div>
  );
}
