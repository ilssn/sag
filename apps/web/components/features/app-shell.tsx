"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import type { Capabilities, Membership, User, WorkspaceRole } from "@/lib/types";
import {
  clearActiveWorkspace,
  getActiveWorkspace,
  setActiveWorkspace,
} from "@/lib/workspace";
import { AppSidebar } from "@/components/features/app-sidebar";
import { SearchProvider } from "@/components/features/search-overlay";
import { SiteHeader } from "@/components/features/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface AppCtx {
  user: User | null;
  capabilities: Capabilities | null;
  /** 当前活动空间 */
  workspace: Membership | null;
  /** 当前用户在活动空间中的角色 */
  role: WorkspaceRole;
  /** 只读成员（viewer）无写权限——用于禁用写入口 */
  canWrite: boolean;
  switchWorkspace: (id: string) => void;
  logout: () => void;
  refreshCapabilities: () => Promise<void>;
}

const AppContext = React.createContext<AppCtx>({
  user: null,
  capabilities: null,
  workspace: null,
  role: "owner",
  canWrite: true,
  switchWorkspace: () => {},
  logout: () => {},
  refreshCapabilities: async () => {},
});

export function useApp() {
  return React.useContext(AppContext);
}

function FullLoader() {
  return (
    <div className="grid h-screen place-items-center bg-paper">
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-9 animate-pulse place-items-center rounded-[9px] bg-gold text-base font-bold text-gold-foreground">
          z
        </span>
        <span className="text-sm text-ink-faint">载入中…</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [capabilities, setCapabilities] = React.useState<Capabilities | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refreshCapabilities = React.useCallback(async () => {
    try {
      setCapabilities(await api.capabilities());
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const [u, c] = await Promise.all([api.me(), api.capabilities()]);
        if (!alive) return;
        // 校准活动空间：本地存储的空间若已不在成员列表中则回落到默认（最早加入的）空间
        const memberships = u.memberships ?? [];
        const stored = getActiveWorkspace();
        const valid = memberships.find((m) => m.workspace_id === stored);
        if (!valid && memberships.length > 0) {
          setActiveWorkspace(memberships[0].workspace_id);
        } else if (memberships.length === 0) {
          clearActiveWorkspace();
        }
        setUser(u);
        setCapabilities(c);
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

  const logout = React.useCallback(() => {
    clearToken();
    clearActiveWorkspace();
    router.replace("/login");
  }, [router]);

  const switchWorkspace = React.useCallback((id: string) => {
    setActiveWorkspace(id);
    // 硬刷新以清空所有携带旧空间数据的组件状态
    window.location.assign("/overview");
  }, []);

  if (loading) return <FullLoader />;
  if (!user) return null;

  const memberships = user.memberships ?? [];
  const activeId = getActiveWorkspace();
  const workspace =
    memberships.find((m) => m.workspace_id === activeId) ?? memberships[0] ?? null;
  const role: WorkspaceRole = workspace?.role ?? "owner";
  const canWrite = role !== "viewer";

  return (
    <AppContext.Provider
      value={{
        user,
        capabilities,
        workspace,
        role,
        canWrite,
        switchWorkspace,
        logout,
        refreshCapabilities,
      }}
    >
      <SearchProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <SiteHeader />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </SearchProvider>
    </AppContext.Provider>
  );
}
