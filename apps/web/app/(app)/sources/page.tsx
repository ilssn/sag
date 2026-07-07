"use client";

import * as React from "react";
import { BookOpen, Brain, Folder, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "@/lib/api";
import type { Namespace, NamespaceKind, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CreateNamespaceDialog } from "@/components/features/create-namespace-dialog";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
import { SourceCard } from "@/components/features/source-card";
import { Skeleton } from "@/components/ui/skeleton";

const NS_ICON: Record<NamespaceKind, LucideIcon> = {
  memory: Brain,
  knowledge: BookOpen,
  custom: Folder,
};

function Chip({
  active,
  onClick,
  label,
  count,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: LucideIcon;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-gold/40 bg-gold-soft text-gold-strong"
          : "border-hairline text-ink-muted hover:bg-surface-2",
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
      <span className={cn("tabular-nums", active ? "text-gold-strong/70" : "text-ink-faint")}>
        {count}
      </span>
    </button>
  );
}

export default function ContextPage() {
  const [namespaces, setNamespaces] = React.useState<Namespace[]>([]);
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null); // null = 全部

  const load = React.useCallback(async () => {
    try {
      const [ns, s] = await Promise.all([api.listNamespaces(), api.listSources()]);
      setNamespaces(ns);
      setSources(s);
    } catch {
      setSources([]);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = (sources ?? []).filter((s) => !selected || s.namespace_id === selected);
  const countOf = (nsId: string) => (sources ?? []).filter((s) => s.namespace_id === nsId).length;

  return (
    <>
      <PageHeader
        title="上下文"
        description="按命名空间组织你的信源 —— 文档、网页，未来还有消息与录音。"
      >
        <CreateSourceDialog onCreated={load} defaultNamespaceId={selected ?? undefined} />
      </PageHeader>

      <div className="p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Chip active={selected === null} onClick={() => setSelected(null)} label="全部" count={sources?.length ?? 0} />
          {namespaces.map((n) => (
            <Chip
              key={n.id}
              active={selected === n.id}
              onClick={() => setSelected(n.id)}
              label={n.name}
              count={countOf(n.id)}
              icon={NS_ICON[n.kind] ?? Folder}
            />
          ))}
          <CreateNamespaceDialog
            onCreated={(ns) => {
              load();
              setSelected(ns.id);
            }}
          />
        </div>

        {sources === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px]" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="这里还没有信源"
            description="创建一个信源，上传文档或同步网页，muse 会解析入库并让你就其提问。"
            action={<CreateSourceDialog onCreated={load} defaultNamespaceId={selected ?? undefined} />}
          />
        ) : (
          <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
