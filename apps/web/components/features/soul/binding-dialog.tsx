"use client";

import * as React from "react";
import { BookOpen, Brain, FileText, Folder, Globe, Link2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Binding, Namespace, Source } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const NS_ICON: Record<string, LucideIcon> = { memory: Brain, knowledge: BookOpen, custom: Folder };

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
  const [namespaces, setNamespaces] = React.useState<Namespace[]>([]);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [pick, setPick] = React.useState("");

  const load = React.useCallback(async () => {
    const [b, ns, s] = await Promise.all([
      api.listBindings(soulId),
      api.listNamespaces(),
      api.listSources(),
    ]);
    setBindings(b);
    setNamespaces(ns);
    setSources(s);
  }, [soulId]);

  React.useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, load]);

  const boundKey = new Set(bindings.map((b) => `${b.target_type}:${b.target_id}`));
  const nameOf = (b: Binding) =>
    b.target_type === "namespace"
      ? namespaces.find((n) => n.id === b.target_id)?.name ?? "分组"
      : sources.find((s) => s.id === b.target_id)?.name ?? "知识库";

  async function add() {
    if (!pick) return;
    const [type, id] = pick.split(":");
    try {
      await api.addBinding(soulId, { target_type: type as "namespace" | "source", target_id: id });
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定知识库</DialogTitle>
          <DialogDescription>
            选择该 Agent可检索的分组或知识库。绑定分组会包含其下全部知识库。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {bindings.length === 0 && <span className="text-sm text-ink-faint">尚未绑定任何知识库</span>}
            {bindings.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold-soft px-2.5 py-1 text-xs text-gold-strong"
              >
                {b.target_type === "namespace" ? <Folder className="size-3.5" /> : <FileText className="size-3.5" />}
                {nameOf(b)}
                <button onClick={() => remove(b)} className="hover:text-danger">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-9 flex-1 rounded-sm border border-hairline bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <option value="">选择要绑定的分组 / 知识库…</option>
              <optgroup label="分组">
                {namespaces
                  .filter((n) => !boundKey.has(`namespace:${n.id}`))
                  .map((n) => (
                    <option key={n.id} value={`namespace:${n.id}`}>
                      {n.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="知识库">
                {sources
                  .filter((s) => !boundKey.has(`source:${s.id}`))
                  .map((s) => (
                    <option key={s.id} value={`source:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
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
