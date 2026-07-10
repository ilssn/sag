"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Download,
  Eye,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { Doc } from "@/lib/types";
import { formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/components/features/markdown-content";
import { DocStatusBadge } from "@/components/features/status-badge";
import { Button } from "@/components/ui/button";
import type { ImperativePanelHandle } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  /** 详情 ResizablePanel 的命令句柄（放大/还原经官方 resize API） */
  panelRef: React.RefObject<ImperativePanelHandle | null>;
}

const Ctx = React.createContext<PanelCtx>({
  target: null,
  maximized: false,
  open: () => {},
  close: () => {},
  toggleMaximize: () => {},
  panelRef: { current: null },
});

const DEFAULT_PANEL_SIZE = 34;

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
  const panelRef = React.useRef<ImperativePanelHandle | null>(null);
  const resetPanelSize = React.useCallback(() => {
    panelRef.current?.resize(DEFAULT_PANEL_SIZE);
  }, []);
  const close = React.useCallback(() => {
    resetPanelSize();
    setTarget(null);
    setMaximized(false);
  }, [resetPanelSize]);
  const toggleMaximize = React.useCallback(() => {
    setMaximized((m) => {
      const next = !m;
      const panel = panelRef.current;
      if (panel) {
        if (next) {
          panel.resize(100);
        } else {
          panel.resize(DEFAULT_PANEL_SIZE);
        }
      }
      return next;
    });
  }, []);

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
    <Ctx.Provider value={{ target, maximized, open, close, toggleMaximize, panelRef }}>
      {children}
    </Ctx.Provider>
  );
}

/** 主内容区：面板放大时隐藏（只留左侧菜单 + 面板）。 */
export function DetailPanelMain({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-w-0 overflow-y-auto overscroll-contain">{children}</div>;
}

// ── 内容视图 ─────────────────────────────────────────────────────────

/** 单按钮切换 Markdown 预览与原始内容，图标表示当前模式。 */
function RenderModeToggle({
  mode,
  onChange,
}: {
  mode: "md" | "raw";
  onChange: (m: "md" | "raw") => void;
}) {
  const isPreview = mode === "md";
  const label = isPreview ? "切换到原始 Markdown" : "切换到预览格式";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 bg-background"
          aria-label={label}
          onClick={() => onChange(isPreview ? "raw" : "md")}
        >
          {isPreview ? <Eye /> : <Code2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function TextBody({ text, mode }: { text: string; mode: "md" | "raw" }) {
  if (mode === "md") {
    return (
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
        <MarkdownContent content={text} />
      </div>
    );
  }
  return (
    <pre className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
      {text}
    </pre>
  );
}

function ChunkView({
  target,
}: {
  target: Extract<DetailTarget, { kind: "chunk" }>;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ heading: string; sourceName: string } | null>(null);
  const [mode, setMode] = React.useState<"md" | "raw">("md");
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
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-medium">{meta?.heading}</h3>
          <Link
            href={`/knowledge/${target.sourceId}`}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            出自 {meta?.sourceName ?? target.sourceName ?? "信源"}
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
        <RenderModeToggle mode={mode} onChange={setMode} />
      </div>
      <TextBody text={content} mode={mode} />
    </div>
  );
}

function OriginalDocumentPreview({ doc }: { doc: Doc }) {
  const [state, setState] = React.useState<
    | { phase: "loading" }
    | { phase: "blob"; url: string; kind: "pdf" | "image" }
    | { phase: "text"; text: string }
    | { phase: "none" }
    | { phase: "error"; message: string }
  >({ phase: "loading" });

  const [textMode, setTextMode] = React.useState<"md" | "raw">("md");
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
        <span className="text-xs font-medium text-muted-foreground">原始文件预览</span>
        <span className="flex items-center gap-1.5">
          {state.phase === "text" && <RenderModeToggle mode={textMode} onChange={setTextMode} />}
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={download}>
            <Download />
            下载
          </Button>
        </span>
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
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          <TextBody text={state.text} mode={textMode} />
        </div>
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

type ParsedPreviewState =
  | { phase: "loading" }
  | { phase: "text"; text: string; truncated: boolean }
  | { phase: "none"; message: string }
  | { phase: "error"; message: string };

function ParsedDocumentPreview({ doc }: { doc: Doc }) {
  const [state, setState] = React.useState<ParsedPreviewState>({ phase: "loading" });
  const [textMode, setTextMode] = React.useState<"md" | "raw">("md");
  const parsedUrl = api.documentParsedUrl(doc.source_id, doc.id);

  React.useEffect(() => {
    if (doc.status !== "ready") {
      setState({
        phase: "none",
        message:
          doc.status === "failed"
            ? doc.error || "文档解析失败，暂无 Markdown 预览。"
            : "文档正在解析，完成后即可查看 Markdown 预览。",
      });
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setState({ phase: "loading" });
    fetch(parsedUrl, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) {
          if (alive) {
            setState({ phase: "none", message: "暂未找到解析内容，可重新处理文档后再试。" });
          }
          return;
        }
        if (res.status === 409) {
          if (alive) setState({ phase: "none", message: "文档尚未解析完成。" });
          return;
        }
        if (!res.ok) throw new Error(`解析内容不可用（${res.status}）`);
        const text = await res.text();
        if (!alive) return;
        if (!text.trim()) {
          setState({ phase: "none", message: "解析内容为空，可重新处理文档后再试。" });
          return;
        }
        const limit = 500_000;
        setState({ phase: "text", text: text.slice(0, limit), truncated: text.length > limit });
      })
      .catch((error) => {
        if (!alive || controller.signal.aborted) return;
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "解析内容加载失败",
        });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [doc.error, doc.status, parsedUrl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">解析后的 Markdown</span>
        {state.phase === "text" && <RenderModeToggle mode={textMode} onChange={setTextMode} />}
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
          {state.message}
        </p>
      )}
      {state.phase === "text" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {state.truncated && (
            <p className="text-xs text-muted-foreground">内容较长，预览仅展示前 50 万字符。</p>
          )}
          <TextBody text={state.text} mode={textMode} />
        </div>
      )}
    </div>
  );
}

function DocumentPreview({ doc }: { doc: Doc }) {
  const [previewMode, setPreviewMode] = React.useState<"parsed" | "original">(
    doc.status === "ready" ? "parsed" : "original",
  );

  return (
    <Tabs
      value={previewMode}
      onValueChange={(value) => setPreviewMode(value as "parsed" | "original")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="parsed">解析内容</TabsTrigger>
        <TabsTrigger value="original">原始文件</TabsTrigger>
      </TabsList>
      <TabsContent
        value="parsed"
        className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
      >
        <ParsedDocumentPreview doc={doc} />
      </TabsContent>
      <TabsContent
        value="original"
        className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
      >
        <OriginalDocumentPreview doc={doc} />
      </TabsContent>
    </Tabs>
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

/** lg 断点（详情栏 内嵌/Sheet 的分界）。 */
export function useIsLgUp(): boolean {
  const [isLg, setIsLg] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLg(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isLg;
}

/** 小屏详情：Sheet 覆盖层。 */
export function DetailPanelSheet() {
  const { target, close } = useDetailPanel();
  if (!target) return null;
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

/** 桌面详情：Resizable 面板内的内容（宽度由外层官方组件管理）。 */
export function DetailPanelOutlet() {
  const { target, maximized, close, toggleMaximize } = useDetailPanel();
  if (!target) return null;

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{panelTitle(target)}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleMaximize}
              aria-label={maximized ? "还原" : "放大"}
            >
              {maximized ? <ChevronsRight /> : <ChevronsLeft />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{maximized ? "还原" : "铺开阅读"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={close} aria-label="关闭">
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">关闭</TooltipContent>
        </Tooltip>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-4",
          maximized && "mx-auto w-full max-w-4xl",
        )}
      >
        <PanelBody target={target} />
      </div>
    </aside>
  );
}
