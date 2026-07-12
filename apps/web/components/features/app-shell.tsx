"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Grip } from "lucide-react";
import { motion } from "motion/react";

import { api, ApiError } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { DEFAULT_AGENT_AVATAR, DEFAULT_AGENT_NAME } from "@/lib/branding";
import type { ConversationTransport } from "@/lib/conversation-runtime";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { PetAgent } from "@/lib/pet-agent";
import {
  DEFAULT_SEARCH_STRATEGY,
  isSearchStrategy,
} from "@/lib/retrieval-config";
import { SIDEBAR_THREADS_PAGE_SIZE } from "@/lib/settings-config";
import { streamAgentAsk } from "@/lib/sse";
import type { Agent, Capabilities, Thread, User } from "@/lib/types";
import {
  isWorkspaceSection,
  type WorkspaceSection,
  workspaceSectionFromPathname,
} from "@/lib/workspace";
import {
  UNIVERSE_DETAIL_EVENT,
  dispatchUniverseActivation,
} from "@/lib/universe-events";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/features/app-sidebar";
import { ConversationProvider } from "@/components/features/chat/conversation-provider";
import {
  DetailPanelMain,
  DetailPanelOutlet,
  DetailPanelProvider,
  DetailPanelSheet,
  useDetailPanel,
  useIsLgUp,
} from "@/components/features/detail-panel";
import { KnowledgeProvider } from "@/components/features/knowledge-provider";
import { PetWithPreference } from "@/components/features/pet";
import { PetHeadAvatar } from "@/components/features/pet-head-avatar";
import { QuickModelSetupDialog } from "@/components/features/quick-model-setup-dialog";
import { SearchProvider } from "@/components/features/search/search-provider";
import { SpaceBackdrop } from "@/components/features/space-backdrop";
import { SiteHeader } from "@/components/features/site-header";
import { ThemeToggle } from "@/components/features/theme-toggle";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const KnowledgeUniverse = dynamic(
  () =>
    import("@/components/features/knowledge-universe").then(
      (module) => module.KnowledgeUniverse,
    ),
  { ssr: false },
);

type WindowMode = "full" | "window";
export type WorkspacePanelMode = "hidden" | "mini" | "normal";
type WindowSize = { width: number; height: number };

const WINDOW_MODE_KEY = "sag:window";
const WINDOW_SIZE_KEY = "sag:window-size";
const WORKSPACE_PANEL_KEY = "sag:workspace-panel";
const WORKSPACE_SECTION_KEY = "sag:workspace-section";
const LEGACY_WORKSPACE_MINI_KEY = "sag:workspace-mini-mode";
const DEFAULT_WINDOW_MODE: WindowMode = "window";
const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1360, height: 860 };
const MIN_WINDOW_SIZE: WindowSize = { width: 900, height: 560 };

const CONVERSATION_TRANSPORT: ConversationTransport = {
  createThread: ({ agentId, title, signal }) => api.createThread(agentId, title, signal),
  listMessages: ({ agentId, threadId, cursor, signal }) =>
    api.listMessages(agentId, threadId, { limit: 40, cursor, signal }),
  stream: ({
    agentId,
    threadId,
    query,
    attachmentIds,
    sourceIds,
    knowledgeOnly,
    onEvent,
    signal,
  }) =>
    streamAgentAsk(
      agentId,
      threadId,
      {
        query,
        attachments: attachmentIds,
        source_ids: sourceIds,
        knowledge_only: knowledgeOnly,
      },
      onEvent,
      signal,
    ),
  cancelRun: ({ agentId, threadId, runId }) =>
    api.cancelAgentRun(agentId, threadId, runId),
  approveTool: ({ agentId, threadId, runId, toolCallId }) =>
    api.approveAgentTool(agentId, threadId, runId, toolCallId),
  rejectTool: ({ agentId, threadId, runId, toolCallId, reason }) =>
    api.rejectAgentTool(agentId, threadId, runId, toolCallId, reason),
  deleteMessage: ({ agentId, threadId, messageId }) =>
    api.deleteMessage(agentId, threadId, messageId),
};

function readWorkspacePanel(): WorkspacePanelMode {
  if (typeof window === "undefined") return "hidden";
  try {
    const saved = window.localStorage.getItem(WORKSPACE_PANEL_KEY);
    if (saved === "hidden" || saved === "mini" || saved === "normal") return saved;
  } catch {
    /* The knowledge universe remains the first-entry default. */
  }
  return "hidden";
}

function readWorkspaceSection(): WorkspaceSection {
  if (typeof window === "undefined") return "search";
  try {
    const saved = window.localStorage.getItem(WORKSPACE_SECTION_KEY);
    if (isWorkspaceSection(saved)) return saved;

    // 兼容旧版 mini 状态，迁移后只维护与形态无关的 section。
    const legacy = window.localStorage.getItem(LEGACY_WORKSPACE_MINI_KEY);
    return legacy === "answer" ? "answer" : "search";
  } catch {
    return "search";
  }
}

function persistWorkspace(panel: WorkspacePanelMode, section?: WorkspaceSection) {
  try {
    window.localStorage.setItem(WORKSPACE_PANEL_KEY, panel);
    if (section) window.localStorage.setItem(WORKSPACE_SECTION_KEY, section);
  } catch {
    /* Keep the in-memory state when storage is unavailable. */
  }
}

function readWindowMode(): WindowMode {
  if (typeof window === "undefined") return DEFAULT_WINDOW_MODE;
  try {
    const saved = window.localStorage.getItem(WINDOW_MODE_KEY);
    if (saved === "full" || saved === "window") return saved;
    window.localStorage.setItem(WINDOW_MODE_KEY, DEFAULT_WINDOW_MODE);
  } catch {
    /* Use the default when browser storage is unavailable. */
  }
  return DEFAULT_WINDOW_MODE;
}

function persistWindowMode(mode: WindowMode) {
  try {
    window.localStorage.setItem(WINDOW_MODE_KEY, mode);
  } catch {
    /* The in-memory preference still applies for this session. */
  }
}

function clampWindowSize(size: WindowSize): WindowSize {
  if (typeof window === "undefined") return size;
  const maxWidth = Math.max(360, window.innerWidth - 32);
  const maxHeight = Math.max(420, window.innerHeight - 32);
  const minWidth = Math.min(MIN_WINDOW_SIZE.width, maxWidth);
  const minHeight = Math.min(MIN_WINDOW_SIZE.height, maxHeight);
  return {
    width: Math.min(Math.max(size.width, minWidth), maxWidth),
    height: Math.min(Math.max(size.height, minHeight), maxHeight),
  };
}

function readWindowSize(): WindowSize {
  if (typeof window === "undefined") return DEFAULT_WINDOW_SIZE;
  try {
    const raw = window.localStorage.getItem(WINDOW_SIZE_KEY);
    if (!raw) return clampWindowSize(DEFAULT_WINDOW_SIZE);
    const parsed = JSON.parse(raw) as Partial<WindowSize>;
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
      return clampWindowSize(DEFAULT_WINDOW_SIZE);
    }
    return clampWindowSize({ width: parsed.width, height: parsed.height });
  } catch {
    return clampWindowSize(DEFAULT_WINDOW_SIZE);
  }
}

function persistWindowSize(size: WindowSize) {
  window.localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify(clampWindowSize(size)));
}

interface AppCtx {
  user: User | null;
  capabilities: Capabilities | null;
  /** 默认 agent（客户端主对话入口） */
  agent: Agent | null;
  /** 可编排的桌面角色，与业务 Agent 分离。 */
  petAgent: PetAgent | null;
  replaceAgent: (agent: Agent) => void;
  threads: Thread[];
  hasMoreThreads: boolean;
  threadsExpanded: boolean;
  loadingMoreThreads: boolean;
  refreshThreads: () => Promise<void>;
  loadMoreThreads: () => Promise<void>;
  collapseThreads: () => void;
  windowMode: WindowMode;
  toggleWindowMode: () => void;
  panelMode: WorkspacePanelMode;
  workspaceSection: WorkspaceSection;
  openMiniWorkspace: (section: WorkspaceSection) => void;
  expandWorkspace: () => void;
  minimizeWorkspace: () => void;
  hideWorkspace: () => void;
  logout: () => void;
  refreshCapabilities: () => Promise<void>;
  timezone: string;
  updateTimezone: (timezone: string) => Promise<void>;
}

const AppContext = React.createContext<AppCtx>({
  user: null,
  capabilities: null,
  agent: null,
  petAgent: null,
  replaceAgent: () => {},
  threads: [],
  hasMoreThreads: false,
  threadsExpanded: false,
  loadingMoreThreads: false,
  refreshThreads: async () => {},
  loadMoreThreads: async () => {},
  collapseThreads: () => {},
  windowMode: DEFAULT_WINDOW_MODE,
  toggleWindowMode: () => {},
  panelMode: "hidden",
  workspaceSection: "search",
  openMiniWorkspace: () => {},
  expandWorkspace: () => {},
  minimizeWorkspace: () => {},
  hideWorkspace: () => {},
  logout: () => {},
  refreshCapabilities: async () => {},
  timezone: DEFAULT_TIME_ZONE,
  updateTimezone: async () => {},
});

export function useApp() {
  return React.useContext(AppContext);
}

export function usePetAgent() {
  const petAgent = useApp().petAgent;
  if (!petAgent) throw new Error("usePetAgent must be used inside AppShell");
  return petAgent;
}

function FullLoader() {
  return (
    <div className="bg-space-field grid h-screen place-items-center">
      <SpaceBackdrop />
      <div
        className="relative z-10 flex flex-col items-center gap-2.5"
        role="status"
        aria-live="polite"
      >
        <PetHeadAvatar
          face={DEFAULT_AGENT_AVATAR}
          size="lg"
          className="sag-full-loader__avatar"
        />
        <span className="text-sm text-muted-foreground">载入中…</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const petAgent = React.useMemo(
    () =>
      new PetAgent({
        name: DEFAULT_AGENT_NAME,
        avatar: DEFAULT_AGENT_AVATAR,
        serialNumber: 1,
        size: 1,
      }),
    [],
  );
  const [user, setUser] = React.useState<User | null>(null);
  const [capabilities, setCapabilities] = React.useState<Capabilities | null>(null);
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = React.useState(false);
  const [threadsExpanded, setThreadsExpanded] = React.useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = React.useState(false);
  const [windowMode, setWindowMode] = React.useState<WindowMode>(DEFAULT_WINDOW_MODE);
  const [panelMode, setPanelMode] = React.useState<WorkspacePanelMode>("hidden");
  const [workspaceSection, setWorkspaceSection] = React.useState<WorkspaceSection>("search");
  const [windowSize, setWindowSize] = React.useState<WindowSize>(DEFAULT_WINDOW_SIZE);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [isDesktop, setIsDesktop] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [quickSetupOpen, setQuickSetupOpen] = React.useState(false);
  const [timezone, setTimezone] = React.useState(DEFAULT_TIME_ZONE);
  const sidebarOpenRef = React.useRef(true);
  const restoreSidebarOpenRef = React.useRef<boolean | null>(null);
  const threadLimitRef = React.useRef(SIDEBAR_THREADS_PAGE_SIZE);
  const threadRequestIdRef = React.useRef(0);
  const loadingMoreThreadsRef = React.useRef(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 窗口形态：首次启动默认小窗，已有用户沿用已保存的偏好。
  React.useEffect(() => {
    setWindowMode(readWindowMode());
    setWindowSize(readWindowSize());
    setPanelMode(/^\/chat\/[^/]+/.test(pathname) ? "normal" : readWorkspacePanel());
    setWorkspaceSection(readWorkspaceSection());
  }, [pathname]);
  const toggleWindowMode = React.useCallback(() => {
    setWindowMode((m) => {
      const next: WindowMode = m === "full" ? "window" : "full";
      persistWindowMode(next);
      return next;
    });
  }, []);

  const openMiniWorkspace = React.useCallback((section: WorkspaceSection) => {
    setWorkspaceSection(section);
    setPanelMode("mini");
    persistWorkspace("mini", section);
  }, []);
  const expandWorkspace = React.useCallback(() => {
    setPanelMode("normal");
    persistWorkspace("normal");
  }, []);
  const minimizeWorkspace = React.useCallback(() => {
    const nextSection = workspaceSectionFromPathname(pathname) ?? workspaceSection;
    setWorkspaceSection(nextSection);
    setPanelMode("mini");
    persistWorkspace("mini", nextSection);
  }, [pathname, workspaceSection]);
  const hideWorkspace = React.useCallback(() => {
    setPanelMode("hidden");
    persistWorkspace("hidden");
  }, []);

  React.useEffect(() => {
    const revealDetail = () => {
      if (panelMode === "hidden") {
        setWorkspaceSection("search");
        setPanelMode("mini");
        persistWorkspace("mini", "search");
      }
    };
    window.addEventListener(UNIVERSE_DETAIL_EVENT, revealDetail);
    return () => window.removeEventListener(UNIVERSE_DETAIL_EVENT, revealDetail);
  }, [panelMode]);

  const windowed = windowMode === "window" && isDesktop;

  React.useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  React.useEffect(() => {
    const onDetailMaximized = (event: Event) => {
      const maximized = Boolean((event as CustomEvent<boolean>).detail);
      if (maximized) {
        if (restoreSidebarOpenRef.current === null) {
          restoreSidebarOpenRef.current = sidebarOpenRef.current;
        }
        setSidebarOpen(false);
        return;
      }
      if (restoreSidebarOpenRef.current !== null) {
        setSidebarOpen(restoreSidebarOpenRef.current);
        restoreSidebarOpenRef.current = null;
      }
    };
    window.addEventListener("sag:detail-maximized", onDetailMaximized);
    return () => window.removeEventListener("sag:detail-maximized", onDetailMaximized);
  }, []);

  React.useEffect(() => {
    if (!windowed) return;
    const onResize = () => setWindowSize((size) => clampWindowSize(size));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [windowed]);

  const startWindowResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startSize = windowSize;
      let nextSize = startSize;
      const previousCursor = document.documentElement.style.cursor;
      const previousSelect = document.documentElement.style.userSelect;

      document.documentElement.style.cursor = "nwse-resize";
      document.documentElement.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        nextSize = clampWindowSize({
          width: startSize.width + moveEvent.clientX - startX,
          height: startSize.height + moveEvent.clientY - startY,
        });
        setWindowSize(nextSize);
      };

      const onUp = () => {
        document.documentElement.style.cursor = previousCursor;
        document.documentElement.style.userSelect = previousSelect;
        persistWindowSize(nextSize);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [windowSize],
  );

  const refreshCapabilities = React.useCallback(async () => {
    try {
      const next = await api.capabilities();
      setCapabilities(next);
      setTimezone(next.timezone || DEFAULT_TIME_ZONE);
    } catch {
      /* ignore */
    }
  }, []);

  const updateTimezone = React.useCallback(async (nextTimezone: string) => {
    const preferences = await api.saveSystemPreferences({ timezone: nextTimezone });
    setTimezone(preferences.timezone);
    setCapabilities((current) =>
      current ? { ...current, timezone: preferences.timezone } : current,
    );
  }, []);

  const loadThreadLimit = React.useCallback(async (targetAgent: Agent, limit: number) => {
    const requestId = ++threadRequestIdRef.current;
    const page = await api.listThreads(targetAgent.id, { limit: limit + 1 });
    if (requestId !== threadRequestIdRef.current) return;

    const visible = page.slice(0, limit);
    const expanded = limit > SIDEBAR_THREADS_PAGE_SIZE && visible.length > SIDEBAR_THREADS_PAGE_SIZE;

    setThreads(visible);
    setHasMoreThreads(page.length > limit);
    setThreadsExpanded(expanded);
    if (!expanded) threadLimitRef.current = SIDEBAR_THREADS_PAGE_SIZE;
  }, []);

  const refreshThreads = React.useCallback(async () => {
    try {
      const targetAgent = agent ?? (await api.getDefaultAgent());
      await loadThreadLimit(targetAgent, threadLimitRef.current);
    } catch {
      /* keep the current sidebar list when refresh fails */
    }
  }, [agent, loadThreadLimit]);

  const loadMoreThreads = React.useCallback(async () => {
    if (!agent || loadingMoreThreadsRef.current) return;
    const previousLimit = threadLimitRef.current;
    const nextLimit = previousLimit + SIDEBAR_THREADS_PAGE_SIZE;
    threadLimitRef.current = nextLimit;
    loadingMoreThreadsRef.current = true;
    setLoadingMoreThreads(true);
    try {
      await loadThreadLimit(agent, nextLimit);
    } catch (error) {
      if (threadLimitRef.current === nextLimit) threadLimitRef.current = previousLimit;
      throw error;
    } finally {
      loadingMoreThreadsRef.current = false;
      setLoadingMoreThreads(false);
    }
  }, [agent, loadThreadLimit]);

  const collapseThreads = React.useCallback(() => {
    threadRequestIdRef.current += 1;
    threadLimitRef.current = SIDEBAR_THREADS_PAGE_SIZE;
    setThreads((current) => current.slice(0, SIDEBAR_THREADS_PAGE_SIZE));
    setThreadsExpanded(false);
    setHasMoreThreads(true);
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [u, c, a, setup] = await Promise.all([
          api.me(),
          api.capabilities(),
          api.getDefaultAgent(),
          api.modelSetupStatus().catch(() => null),
        ]);
        if (!alive) return;
        setUser(u);
        setCapabilities(c);
        setTimezone(c.timezone || DEFAULT_TIME_ZONE);
        setAgent(a);
        setQuickSetupOpen(Boolean(setup?.required));
        threadLimitRef.current = SIDEBAR_THREADS_PAGE_SIZE;
        loadThreadLimit(a, SIDEBAR_THREADS_PAGE_SIZE).catch(() => {});
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      threadRequestIdRef.current += 1;
    };
  }, [loadThreadLimit, router]);

  // 快捷键只切换内容 section；mini 是同一工作台的紧凑形态。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openMiniWorkspace("search");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openMiniWorkspace("answer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMiniWorkspace]);

  const logout = React.useCallback(() => {
    clearToken();
    router.replace("/login");
  }, [router]);

  if (loading) return <FullLoader />;
  if (!user || !agent) return null;

  return (
    <AppContext.Provider
      value={{
        user,
        capabilities,
        agent,
        petAgent,
        replaceAgent: setAgent,
        threads,
        hasMoreThreads,
        threadsExpanded,
        loadingMoreThreads,
        refreshThreads,
        loadMoreThreads,
        collapseThreads,
        windowMode,
        toggleWindowMode,
        panelMode,
        workspaceSection,
        openMiniWorkspace,
        expandWorkspace,
        minimizeWorkspace,
        hideWorkspace,
        logout,
        refreshCapabilities,
        timezone,
        updateTimezone,
      }}
    >
      <SearchProvider
        defaultStrategy={
          isSearchStrategy(capabilities?.search_strategy)
            ? capabilities.search_strategy
            : DEFAULT_SEARCH_STRATEGY
        }
      >
        <KnowledgeProvider>
          <ConversationProvider
            agentId={agent.id}
            transport={CONVERSATION_TRANSPORT}
            onActivity={refreshThreads}
            onUniverseActivation={dispatchUniverseActivation}
          >
            <QuickModelSetupDialog
              open={quickSetupOpen}
              onOpenChange={setQuickSetupOpen}
              onConfigured={(nextCapabilities) => {
                setCapabilities(nextCapabilities);
                setTimezone(nextCapabilities.timezone || DEFAULT_TIME_ZONE);
                setQuickSetupOpen(false);
              }}
            />
            <DetailPanelProvider>
              <div
                className={cn(
                  "bg-space-field relative grid min-h-svh overflow-hidden",
                  windowed && "place-items-center p-4 md:p-8",
                )}
              >
                <SpaceBackdrop />
                <KnowledgeUniverse interactive={panelMode !== "normal"} />
                {panelMode !== "normal" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-4 top-4 z-30 rounded-md border border-border/60 bg-background/70 shadow-soft backdrop-blur-md"
                  >
                    <ThemeToggle />
                  </motion.div>
                )}
                <motion.div
                  initial={false}
                  animate={
                    panelMode === "normal"
                      ? { opacity: 1, scale: 1, y: 0 }
                      : { opacity: 0, scale: 0.9, y: 24 }
                  }
                  transition={{ type: "spring", stiffness: 340, damping: 30 }}
                  style={
                    windowed
                      ? {
                          width: windowSize.width,
                          height: windowSize.height,
                        }
                      : { width: "100%", height: "100svh" }
                  }
                  aria-hidden={panelMode !== "normal"}
                  className={cn(
                    "relative z-10",
                    panelMode !== "normal" && "invisible pointer-events-none",
                    windowed
                      ? // transform 使内部 fixed 的 Sidebar 以本窗体为 containing block（Mac 窗口形态）
                        "max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] transform-gpu overflow-hidden rounded-xl border bg-background shadow-lift"
                      : "min-h-svh",
                  )}
                >
                  <SidebarProvider
                    open={sidebarOpen}
                    onOpenChange={setSidebarOpen}
                    className={cn(windowed ? "h-full min-h-full" : "h-svh min-h-svh")}
                  >
                    <AppSidebar contained={windowed} />
                    <SidebarInset className="min-w-0">
                      <SiteHeader />
                      <ContentArea>{children}</ContentArea>
                    </SidebarInset>
                  </SidebarProvider>
                  {windowed && (
                    <button
                      type="button"
                      aria-label="调整窗口大小"
                      title="调整窗口大小"
                      onPointerDown={startWindowResize}
                      className="absolute bottom-1.5 right-1.5 z-20 hidden size-7 cursor-nwse-resize items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-muted hover:text-foreground md:flex"
                    >
                      <Grip className="size-3.5 rotate-45" />
                    </button>
                  )}
                </motion.div>
              </div>
              <PetWithPreference character={petAgent} syncIdentity />
            </DetailPanelProvider>
          </ConversationProvider>
        </KnowledgeProvider>
      </SearchProvider>
    </AppContext.Provider>
  );
}

/** 内容区：官方 Resizable 组合——主区 + 可拖宽详情栏（宽度经 autoSaveId 持久化）。 */
function ContentArea({ children }: { children: React.ReactNode }) {
  const { target, maximized, panelRef } = useDetailPanel();
  const lg = useIsLgUp();
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent("sag:detail-maximized", { detail: maximized }));
  }, [maximized]);

  return (
    <>
      <ResizablePanelGroup
        direction="horizontal"
        className="min-h-0 flex-1"
        autoSaveId="sag:detail"
      >
        <ResizablePanel defaultSize={66} minSize={0}>
          <DetailPanelMain>{children}</DetailPanelMain>
        </ResizablePanel>
        {target && lg && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel ref={panelRef} defaultSize={34} minSize={24} maxSize={100} className="flex min-h-0 border-l">
              <DetailPanelOutlet />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {target && !lg && <DetailPanelSheet />}
    </>
  );
}
