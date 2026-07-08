"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Download, Maximize2, Minimize2, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { Doc } from "@/lib/types";
import { formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocStatusBadge } from "@/components/features/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/** 详情面板目标：引用/搜索结果的原文分块，或知识库文档（含原始文件预览）。 */
export type DetailTarget =
  | { kind: "chunk"; sourceId: string; chunkId: string; heading?: string; sourceName?: string }
  | { kind: "document"; sourceId: string; documentId: string; title?: string };

interface PanelCtx {
  target: DetailTarget | null;
  maximized: boolean;
  open: (target: DetailTarget) => void;
  close: () => void;
  toggleMaximize: () => void;
}

const Ctx = React.createContext<PanelCtx>({
  target: null,
  maximized: false,
  open: () => {},
  close: () => {},
  toggleMaximize: () => {},
});

export function useDetailPanel() {
  return React.useContext(Ctx);
}

export function DetailPanelProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [target, setTarget] = React.useState<DetailTarget | null>(null);
  const [maximized, setMaximized] = React.useState(false);

  const open = React.useCallback((t: DetailTarget) => {
    setTarget(t);
  }, []);
  const close = React.useCallback(() => {
    setTarget(null);
    setMaximized(false);
  }, []);
  const toggleMaximize = React.useCallback(() => setMaximized((m) => !m), []);

  // 切换主导航（/chat ↔ /search ↔ /knowledge…）时收起面板
  const section = pathname.split("/")[1];
  const prevSection = React.useRef(section);
  React.useEffect(() => {
    if (prevSection.current !== section) {
      prevSection.current = section;
      close();
    }
  }, [section, close]);

  return (
    <Ctx.Provider value={{ target, maximized, open, close, toggleMaximize }}>
      {children}
    </Ctx.Provider>
  );
}

/** 主内容区：面板放大时隐藏（只留左侧菜单 + 面板）。 */
export function DetailPanelMain({ children }: { children: React.ReactNode }) {
  const { target, maximized } = useDetailPanel();
  return (
    <div
      className={cn(
        "min-w-0 flex-1 overflow-y-auto overscroll-contain",
        target && maximized && "hidden",
      )}
    >
      {children}
    </div>
  );
}

// ── 内容视图 ─────────────────────────────────────────────────────────

function ChunkView({
  target,
}: {
  target: Extract<DetailTarget, { kind: "chunk" }>;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ heading: string; sourceName: string } | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setContent(null);
    setError("");
    api
      .getChunk(target.sourceId, target.chunkId)
      .then((c) => {
        if (!alive) return;
        setContent(c.content);
        setMeta({ heading: c.heading || target.heading || "原文片段", sourceName: c.source_name });
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "原文加载失败"));
    return () => {
      alive = false;
    };
  }, [target]);

  if (error) {
    return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  }
  if (content === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-display text-base font-medium">{meta?.heading}</h3>
        <Link
          href={`/knowledge/${target.sourceId}`}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          出自 {meta?.sourceName ?? target.sourceName ?? "信源"}
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function DocumentPreview({ doc }: { doc: Doc }) {
  const [state, setState] = React.useState<
    | { phase: "loading" }
    | { phase: "blob"; url: string; kind: "pdf" | "image" }
    | { phase: "text"; text: string }
    | { phase: "none" }
    | { phase: "error"; message: string }
  >({ phase: "loading" });

  const fileUrl = api.documentFileUrl(doc.source_id, doc.id);

  React.useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setState({ phase: "loading" });
    (async () => {
      try {
        const res = await fetch(fileUrl, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok) throw new Error(`原始文件不可用（${res.status}）`);
        const ct = (res.headers.get("content-type") || doc.content_type || "").toLowerCase();
        if (ct.includes("pdf")) {
          objectUrl = URL.createObjectURL(await res.blob());
          if (alive) setState({ phase: "blob", url: objectUrl, kind: "pdf" });
        } else if (ct.startsWith("image/")) {
          objectUrl = URL.createObjectURL(await res.blob());
          if (alive) setState({ phase: "blob", url: objectUrl, kind: "image" });
        } else if (
          ct.startsWith("text/") ||
          ct.includes("markdown") ||
          ct.includes("json") ||
          ct.includes("csv")
        ) {
          const text = await res.text();
          if (alive) setState({ phase: "text", text: text.slice(0, 200_000) });
        } else {
          if (alive) setState({ phase: "none" });
        }
      } catch (e) {
        if (alive) setState({ phase: "error", message: e instanceof Error ? e.message : "加载失败" });
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id, doc.source_id, doc.content_type, fileUrl]);

  async function download() {
    try {
      const res = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("下载失败");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* 提示由浏览器兜底 */
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">原文预览</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={download}>
          <Download />
          下载
        </Button>
      </div>
      {state.phase === "loading" && (
        <div className="grid flex-1 place-items-center rounded-md border">
          <Spinner />
        </div>
      )}
      {state.phase === "error" && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.phase === "none" && (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          该文件类型暂不支持预览，可下载查看。
        </p>
      )}
      {state.phase === "text" && (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
          {state.text}
        </pre>
      )}
      {state.phase === "blob" && state.kind === "pdf" && (
        <iframe title={doc.filename} src={state.url} className="min-h-0 flex-1 rounded-md border" />
      )}
      {state.phase === "blob" && state.kind === "image" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.url} alt={doc.filename} className="mx-auto max-w-full" />
        </div>
      )}
    </div>
  );
}

function DocumentView({
  target,
}: {
  target: Extract<DetailTarget, { kind: "document" }>;
}) {
  const [doc, setDoc] = React.useState<Doc | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setDoc(null);
    setError("");
    api
      .getDocument(target.sourceId, target.documentId)
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "文档加载失败"));
    return () => {
      alive = false;
    };
  }, [target]);

  if (error) {
    return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  }
  if (!doc) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="break-all font-display text-base font-medium">{doc.filename}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DocStatusBadge status={doc.status} />
          <span>{formatBytes(doc.size_bytes)}</span>
          <span>·</span>
          <span>{doc.chunk_count} 分块</span>
          <span>·</span>
          <span>{doc.event_count} 事件</span>
          <span>·</span>
          <span>{relativeTime(doc.created_at)}</span>
        </div>
        {doc.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {doc.error}
          </p>
        )}
      </div>
      <DocumentPreview doc={doc} />
    </div>
  );
}

// ── 面板外壳 ─────────────────────────────────────────────────────────

function PanelBody({ target }: { target: DetailTarget }) {
  return target.kind === "chunk" ? <ChunkView target={target} /> : <DocumentView target={target} />;
}

function panelTitle(target: DetailTarget): string {
  return target.kind === "chunk" ? "原文溯源" : "文档详情";
}

/** 右侧详情栏：lg 及以上为内嵌第三栏（可放大占满主区），小屏退化为 Sheet。 */
export function DetailPanelOutlet() {
  const { target, maximized, close, toggleMaximize } = useDetailPanel();
  const [isDesktop, setIsDesktop] = React.useState(true);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!target) return null;

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 sm:max-w-lg">
          <SheetTitle className="text-sm font-medium">{panelTitle(target)}</SheetTitle>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PanelBody target={target} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l bg-background",
        maximized ? "flex-1" : "w-[440px] shrink-0 xl:w-[520px]",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{panelTitle(target)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={toggleMaximize}
          title={maximized ? "还原" : "放大"}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={close} title="关闭">
          <X />
        </Button>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto p-4",
          maximized && "mx-auto w-full max-w-4xl",
        )}
      >
        <PanelBody target={target} />
      </div>
    </aside>
  );
}
