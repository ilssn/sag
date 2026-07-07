"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Flame, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Entity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PERSON_TYPES = new Set(["person", "人物", "people", "character"]);

export function EntityInsights({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [entities, setEntities] = React.useState<Entity[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.listEntities(sourceId).then(setEntities).catch(() => setEntities([]));
  }, [sourceId]);

  async function toSoul(e: Entity) {
    setBusy(e.id);
    try {
      const soul = await api.entityToSoul(sourceId, e.id);
      toast.success(`已为「${e.name}」创建 Agent`);
      router.push(`/souls/${soul.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "提取失败");
    } finally {
      setBusy(null);
    }
  }

  if (entities === null || entities.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-surface/40 px-4 py-6 text-center text-sm text-ink-faint">
        抽取完成后，这里会按热度列出人物与实体，可一键创建 Agent 与之对话。
      </p>
    );
  }

  const maxHeat = Math.max(...entities.map((e) => e.heat), 1);

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      {entities.map((e, i) => {
        const isPerson = PERSON_TYPES.has(e.type.toLowerCase());
        return (
          <div
            key={e.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60",
              i > 0 && "border-t border-hairline",
            )}
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-strong">
              {isPerson ? <User className="size-4" /> : <Sparkles className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{e.name}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-faint">{e.type}</span>
              </div>
              {e.description && <div className="truncate text-xs text-ink-muted">{e.description}</div>}
            </div>
            <div className="hidden w-24 items-center gap-1.5 sm:flex" title={`热度 ${e.heat}`}>
              <Flame className="size-3.5 shrink-0 text-gold-strong" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-gold" style={{ width: `${(e.heat / maxHeat) * 100}%` }} />
              </div>
            </div>
            {isPerson && (
              <Button variant="outline" size="sm" disabled={busy === e.id} onClick={() => toSoul(e)}>
                <Sparkles className="size-3.5" />
                {busy === e.id ? "提取中…" : "创建 Agent"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
