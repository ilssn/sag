"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";
import { CreateAgentDialog } from "@/components/features/agent/create-agent-dialog";
import { AgentCard } from "@/components/features/agent/agent-card";
import { EmptyState } from "@/components/features/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function AssistantsPage() {
  const [agents, setAgents] = React.useState<Agent[] | null>(null);

  const load = React.useCallback(() => {
    api.listAgents().then(setAgents).catch(() => setAgents([]));
  }, []);
  React.useEffect(() => load(), [load]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">助手</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            给它一个设定、绑定信源，它就能带引用地依据你的内容作答。
          </p>
        </div>
        <CreateAgentDialog onCreated={load} />
      </div>

      <div>
        {agents === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[132px]" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="创建第一个助手"
            description="起个名字、写好设定，绑定你的信源——它就能成为最懂这些资料、回答带引用的助手。"
            action={<CreateAgentDialog onCreated={load} />}
          />
        ) : (
          <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((s) => (
              <AgentCard key={s.id} agent={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
