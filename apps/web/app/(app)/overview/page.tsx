"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, Layers, Sparkles, TriangleAlert, Zap } from "lucide-react";

import { api } from "@/lib/api";
import type { Soul, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { CreateSoulDialog } from "@/components/features/soul/create-soul-dialog";
import { SoulCard } from "@/components/features/soul/soul-card";
import { SourceCard } from "@/components/features/source-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function SectionHeader({ title, href, hrefLabel }: { title: string; href: string; hrefLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-medium">{title}</h2>
      <Button asChild variant="link" size="sm" className="h-auto p-0 text-muted-foreground">
        <Link href={href}>
          {hrefLabel}
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function GoldenPath({
  hasSource,
  hasDoc,
  hasAssistant,
  onChanged,
}: {
  hasSource: boolean;
  hasDoc: boolean;
  hasAssistant: boolean;
  onChanged: () => void;
}) {
  const steps = [
    {
      done: hasSource && hasDoc,
      title: "新建信源，上传文档",
      desc: "zleap 会自动解析、分块并抽取事件。",
      action: <CreateSourceDialog onCreated={onChanged} />,
    },
    {
      done: hasAssistant,
      title: "创建助手，绑定信源",
      desc: "起个名字、写好设定，它就能依据你的内容作答。",
      action: <CreateSoulDialog onCreated={onChanged} />,
    },
    {
      done: false,
      title: "开始对话",
      desc: "回答带引用，可追溯到原文；越聊越有记忆。",
      action: (
        <Button asChild variant="outline">
          <Link href="/assistants">
            前往助手
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      ),
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <Card className="overflow-hidden py-0">
      {steps.map((s, i) => {
        const focus = i === current;
        return (
          <div
            key={s.title}
            className={cn(
              "flex flex-wrap items-center gap-4 px-5 py-4",
              i > 0 && "border-t",
              focus && "bg-muted/40",
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-[13px] font-semibold tabular-nums",
                s.done
                  ? "border-transparent bg-primary text-primary-foreground"
                  : focus
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground",
              )}
            >
              {s.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm font-medium",
                  s.done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {s.title}
              </div>
              <div className="text-xs text-muted-foreground">{s.desc}</div>
            </div>
            {focus && <div className="shrink-0">{s.action}</div>}
          </div>
        );
      })}
    </Card>
  );
}

export default function OverviewPage() {
  const { user, capabilities } = useApp();
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [souls, setSouls] = React.useState<Soul[] | null>(null);

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
    api.listSouls().then(setSouls).catch(() => setSouls([]));
  }, []);
  React.useEffect(() => load(), [load]);

  const loading = sources === null || souls === null;
  const totals = React.useMemo(() => {
    const s = sources ?? [];
    return {
      assistants: (souls ?? []).length,
      sources: s.length,
      documents: s.reduce((a, x) => a + x.document_count, 0),
      events: s.reduce((a, x) => a + x.event_count, 0),
    };
  }, [sources, souls]);

  const hasDoc = (sources ?? []).some((s) => s.document_count > 0);
  const onboarding = !loading && (totals.sources === 0 || !hasDoc || totals.assistants === 0);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{`欢迎回来，${user?.name ?? ""}`}</h1>
        <p className="mt-1 text-sm text-muted-foreground">上传信息，创建助手，带引用对话。</p>
      </div>

      {capabilities && !capabilities.llm_configured && (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>尚未配置模型</AlertTitle>
          <AlertDescription>
            前往
            <Link href="/settings" className="font-medium underline underline-offset-2">
              设置
            </Link>
            配置 LLM 后，即可进行事件抽取与问答。
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="助手" value={totals.assistants} icon={Sparkles} />
          <Metric label="信源" value={totals.sources} icon={Layers} />
          <Metric label="文档" value={totals.documents} icon={FileText} />
          <Metric label="抽取事件" value={totals.events} icon={Zap} />
        </div>
      )}

      {loading ? (
        <Skeleton className="h-[180px]" />
      ) : onboarding ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">三步开始</h2>
          <GoldenPath
            hasSource={totals.sources > 0}
            hasDoc={hasDoc}
            hasAssistant={totals.assistants > 0}
            onChanged={load}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <SectionHeader title="我的助手" href="/assistants" hrefLabel="全部助手" />
            <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(souls ?? []).slice(0, 3).map((s) => (
                <SoulCard key={s.id} soul={s} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <SectionHeader title="最近信源" href="/sources" hrefLabel="全部信源" />
            <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(sources ?? []).slice(0, 3).map((s) => (
                <SourceCard key={s.id} source={s} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
