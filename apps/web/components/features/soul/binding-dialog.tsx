"use client";

import * as React from "react";
import { FileText, Link2, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Binding, Source } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function BindingDialog({
  soulId,
  trigger,
  onChanged,
}: {
  soulId: string;
  trigger: React.ReactNode;
  onChanged?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [bindings, setBindings] = React.useState<Binding[]>([]);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [pick, setPick] = React.useState("");

  const load = React.useCallback(async () => {
    const [b, s] = await Promise.all([api.listBindings(soulId), api.listSources()]);
    // 界面只呈现信源级绑定
    setBindings(b.filter((x) => x.target_type === "source"));
    setSources(s);
  }, [soulId]);

  React.useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, load]);

  const bound = new Set(bindings.map((b) => b.target_id));
  const nameOf = (b: Binding) => sources.find((s) => s.id === b.target_id)?.name ?? "信源";

  async function add() {
    if (!pick) return;
    try {
      await api.addBinding(soulId, { target_type: "source", target_id: pick });
      setPick("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "绑定失败");
    }
  }

  async function remove(b: Binding) {
    try {
      await api.removeBinding(soulId, b.id);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "解绑失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>绑定信源</DialogTitle>
          <DialogDescription>助手回答时，会在绑定的信源与自己的记忆中检索。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {bindings.length === 0 && (
              <span className="text-sm text-ink-faint">尚未绑定任何信源</span>
            )}
            {bindings.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold-soft px-2.5 py-1 text-xs text-gold-strong"
              >
                <FileText className="size-3.5" />
                {nameOf(b)}
                <button onClick={() => remove(b)} className="hover:text-danger" aria-label="解绑">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">选择要绑定的信源…</option>
              {sources
                .filter((s) => !bound.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <Button variant="gold" onClick={add} disabled={!pick}>
              <Link2 className="size-4" />
              绑定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
