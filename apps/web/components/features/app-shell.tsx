"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import type { Agent, Capabilities, Thread, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/features/app-sidebar";
import {
  DetailPanelMain,
  DetailPanelOutlet,
  DetailPanelProvider,
} from "@/components/features/detail-panel";
import { Pet, usePetEnabled } from "@/components/features/pet";
import { SiteHeader } from "@/components/features/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

type WindowMode = "full" | "window";

interface AppCtx {
  user: User | null;
  capabilities: Capabilities | null;
  /** 默认 agent（客户端主对话入口） */
  agent: Agent | null;
  threads: Thread[];
  refreshThreads: () => Promise<void>;
  windowMode: WindowMode;
  toggleWindowMode: () => void;
  logout: () => void;
  refreshCapabilities: () => Promise<void>;
}

const AppContext = React.createContext<AppCtx>({
  user: null,
  capabilities: null,
  agent: null,
  threads: [],
  refreshThreads: async () => {},
  windowMode: "full",
  toggleWindowMode: () => {},
  logout: () => {},
  refreshCapabilities: async () => {},
});

export function useApp() {
  return React.useContext(AppContext);
}

function FullLoader() {
  return (
    <div className="grid h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-9 animate-pulse place-items-center rounded-[9px] bg-gradient-to-br from-primary to-primary/85 text-base font-bold text-primary-foreground">
          s
        </span>
        <span className="text-sm text-muted-foreground">载入中…</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [capabilities, setCapabilities] = React.useState<Capabilities | null>(null);
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [windowMode, setWindowMode] = React.useState<WindowMode>("full");
  const [isDesktop, setIsDesktop] = React.useState(true);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 窗口形态：持久化（默认满屏）
  React.useEffect(() => {
    if (window.localStorage.getItem("sag:window") === "window") setWindowMode("window");
  }, []);
  const toggleWindowMode = React.useCallback(() => {
    setWindowMode((m) => {
      const next: WindowMode = m === "full" ? "window" : "full";
      window.localStorage.setItem("sag:window", next);
      return next;
    });
  }, []);

  const refreshCapabilities = React.useCallback(async () => {
    try {
      setCapabilities(await api.capabilities());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshThreads = React.useCallback(async () => {
    try {
      const a = agent ?? (await api.getDefaultAgent());
      setThreads(await api.listThreads(a.id));
    } catch {
      /* ignore */
    }
  }, [agent]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [u, c, a] = await Promise.all([api.me(), api.capabilities(), api.getDefaultAgent()]);
        if (!alive) return;
        setUser(u);
        setCapabilities(c);
        setAgent(a);
        api
          .listThreads(a.id)
          .then((t) => alive && setThreads(t))
          .catch(() => {});
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
    };
  }, [router]);

  // ⌘K / Ctrl+K → 搜索页
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const logout = React.useCallback(() => {
    clearToken();
    router.replace("/login");
  }, [router]);

  if (loading) return <FullLoader />;
  if (!user) return null;

  const windowed = windowMode === "window" && isDesktop;
  const [petOn] = usePetEnabled();

  return (
    <AppContext.Provider
      value={{
        user,
        capabilities,
        agent,
        threads,
        refreshThreads,
        windowMode,
        toggleWindowMode,
        logout,
        refreshCapabilities,
      }}
    >
      <DetailPanelProvider>
        <div
          className={cn(
            windowed &&
              "relative grid min-h-svh place-items-center bg-muted/40 bg-dot-grid p-4 md:p-8",
          )}
        >
          <div
            className={cn(
              windowed
                ? // transform 使内部 fixed 的 Sidebar 以本窗体为 containing block（Mac 窗口形态）
                  "relative h-[calc(100svh-2rem)] w-full max-w-[1440px] transform-gpu overflow-hidden rounded-xl border bg-background shadow-lift md:h-[calc(100svh-4rem)]"
                : "min-h-svh",
            )}
          >
            <SidebarProvider className={cn(windowed ? "h-full min-h-full" : "h-svh min-h-svh")}>
              <AppSidebar />
              <SidebarInset className="min-w-0">
                <SiteHeader />
                <div className="flex min-h-0 flex-1">
                  <DetailPanelMain>{children}</DetailPanelMain>
                  <DetailPanelOutlet />
                  {petOn && <Pet />}
                </div>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </div>
      </DetailPanelProvider>
    </AppContext.Provider>
  );
}
