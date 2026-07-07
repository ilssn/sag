"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import type { Soul } from "@/lib/types";
import { CreateSoulDialog } from "@/components/features/soul/create-soul-dialog";
import { SoulCard } from "@/components/features/soul/soul-card";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function SoulsPage() {
  const [souls, setSouls] = React.useState<Soul[] | null>(null);

  const load = React.useCallback(() => {
    api.listSouls().then(setSouls).catch(() => setSouls([]));
  }, []);
  React.useEffect(() => load(), [load]);

  return (
    <>
      <PageHeader title="灵魂" description="有名字、有人格、绑定上下文、带记忆的对话对象。">
        <CreateSoulDialog onCreated={load} />
      </PageHeader>

      <div className="p-6 md:p-8">
        {souls === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[132px]" />
            ))}
          </div>
        ) : souls.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="创造第一个灵魂"
            description="给它名字与人格，绑定你的上下文，让它成为你的助手、决策脑，或书中的某个人物。"
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
    </>
  );
}
