"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  FlaskConical,
  List,
  Network,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { DocumentList } from "@/components/features/document-list";
import { EmptyState } from "@/components/features/empty-state";
import { RetrievalTestDialog } from "@/components/features/retrieval-test-dialog";
import { SourceGraph } from "@/components/features/source-graph";
import { SyncPanel } from "@/components/features/sync-panel";
import { UploadZone } from "@/components/features/upload-zone";
import { useSourceContent } from "@/components/features/use-source-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export default function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { capabilities } = useApp();
  const { source, documents, refresh, notFound } = useSourceContent(id);
  const [contentView, setContentView] = React.useState<"list" | "graph">("list");

  React.useEffect(() => {
    if (window.localStorage.getItem("sag:source-content-view") === "graph") {
      setContentView("graph");
    }
  }, []);

  const changeContentView = (view: "list" | "graph") => {
    setContentView(view);
    window.localStorage.setItem("sag:source-content-view", view);
  };

  React.useEffect(() => {
    if (notFound) router.replace("/knowledge");
  }, [notFound, router]);

  const [addOpen, setAddOpen] = React.useState(false);
  const [retrievalOpen, setRetrievalOpen] = React.useState(false);
  const isFileSource = !source || source.connector_kind === "file_upload";

  return (
    <div
      className={cn(
        "min-h-full",
        contentView === "graph" && "flex h-full min-h-0 flex-col overflow-hidden",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b px-4 py-5 md:px-6">
        <div className="min-w-0">
          <Link
            href="/knowledge"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            全部信源
          </Link>
          {source ? (
            <>
              <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {source.name}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {source.document_count} 文档 · {source.chunk_count} 块 · {source.event_count} 事件
                {source.description ? ` · ${source.description}` : ""}
              </p>
            </>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setAddOpen(true)}
                disabled={!source}
                aria-label={isFileSource ? "添加文档" : "同步信源"}
                title={isFileSource ? "添加文档" : "同步信源"}
              >
                {isFileSource ? (
                  <Plus className="size-4" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isFileSource ? "添加文档" : "同步信源"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRetrievalOpen(true)}
                disabled={!source}
                aria-label="检索测试"
                title="检索测试"
              >
                <FlaskConical className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">检索测试</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                size="icon"
                aria-label="搜索此信息源"
                title="搜索此信息源"
              >
                <Link href={source ? `/search?source=${source.id}` : "/search"}>
                  <Search className="size-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">搜索此信息源</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-4 p-4 transition-[max-width,padding]",
          contentView === "graph"
            ? "min-h-0 max-w-none flex-1 overflow-hidden md:p-5"
            : "max-w-4xl md:p-6",
        )}
      >
        {capabilities && !capabilities.llm_configured && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertTitle>尚未配置模型</AlertTitle>
            <AlertDescription>
              文档仍可上传并解析入库，但<strong>事件抽取</strong>与<strong>问答</strong>需要在
              <Link href="/settings" className="font-medium underline underline-offset-2">
                设置
              </Link>
              中配置 LLM。
            </AlertDescription>
          </Alert>
        )}

        <div className={cn(contentView === "graph" && "flex min-h-0 flex-1 flex-col")}>
          <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {contentView === "list" ? "文档" : "信息源图谱"}{" "}
              {documents ? `（${documents.length}）` : ""}
            </h2>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={contentView}
              onValueChange={(value) =>
                value && changeContentView(value as "list" | "graph")
              }
              aria-label="内容展示方式"
              className="rounded-md bg-card"
            >
              <ToggleGroupItem value="list" className="gap-1.5 px-3" aria-label="列表视图">
                <List className="size-3.5" />
                列表
              </ToggleGroupItem>
              <ToggleGroupItem value="graph" className="gap-1.5 px-3" aria-label="图谱视图">
                <Network className="size-3.5" />
                图谱
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {documents === null || !source ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : contentView === "graph" ? (
            <div className="min-h-0 flex-1">
              <SourceGraph
                source={source}
                refreshKey={documents
                  .map((document) => `${document.id}:${document.status}:${document.event_count}`)
                  .join("|")}
              />
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="还没有文档"
              description="点击右上角添加文档，SAG 会自动解析、分块、向量化并抽取事件与实体。"
            />
          ) : (
            <DocumentList sourceId={id} documents={documents} onChange={refresh} />
          )}
        </div>

      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isFileSource ? "添加文档" : "同步信源"}
            </DialogTitle>
            <DialogDescription>
              {isFileSource
                ? "添加后会自动解析、分块并抽取事件与实体。"
                : "抓取连接器中的最新内容并更新信息源。"}
            </DialogDescription>
          </DialogHeader>
          {source &&
            (source.connector_kind === "file_upload" ? (
              <UploadZone
                sourceId={id}
                onUploaded={() => {
                  setAddOpen(false);
                  void refresh();
                }}
                maxMb={capabilities?.max_upload_mb ?? 25}
                allowedExts={capabilities?.allowed_upload_exts}
              />
            ) : (
              <SyncPanel
                sourceId={id}
                onSynced={() => {
                  setAddOpen(false);
                  void refresh();
                }}
              />
            ))}
        </DialogContent>
      </Dialog>

      {source && (
        <RetrievalTestDialog
          sourceId={source.id}
          sourceName={source.name}
          open={retrievalOpen}
          onOpenChange={setRetrievalOpen}
        />
      )}
    </div>
  );
}
