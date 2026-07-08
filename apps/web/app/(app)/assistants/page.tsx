"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import type { Soul } from "@/lib/types";
import { CreateSoulDialog } from "@/components/features/soul/create-soul-dialog";
import { SoulCard } from "@/components/features/soul/soul-card";
import { EmptyState } from "@/components/features/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function SoulsPage() {
  const [souls, setSouls] = React.useState<Soul[] | null>(null);

  const load = React.useCallback(() => {
    api.listSouls().then(setSouls).catch(() => setSouls([]));
  }, []);
  React.useEffect(() => load(), [load]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">助手</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            有名字、有设定、有记忆的 AI 同事，绑定信源后即可带引用对话。
          </p>
        </div>
        <CreateSoulDialog onCreated={load} />
      </div>

      <div>
        {souls === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[132px]" />
            ))}
          </div>
        ) : souls.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="创建第一个助手"
            description="起个名字、写好设定，绑定你的信源——它可以是你的助手、团队的决策脑，或书中的某个人物。"
            action={<CreateSoulDialog onCreated={load} />}
          />
        ) : (
          <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {souls.map((s) => (
              <SoulCard key={s.id} soul={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
