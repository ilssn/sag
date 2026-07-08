"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import type { Capabilities, User } from "@/lib/types";
import { AppSidebar } from "@/components/features/app-sidebar";
import { SearchProvider } from "@/components/features/search-overlay";
import { SiteHeader } from "@/components/features/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface AppCtx {
  user: User | null;
  capabilities: Capabilities | null;
  logout: () => void;
  refreshCapabilities: () => Promise<void>;
}

const AppContext = React.createContext<AppCtx>({
  user: null,
  capabilities: null,
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
        <span className="grid size-9 animate-pulse place-items-center rounded-[9px] bg-primary text-base font-bold text-primary-foreground">
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
    router.replace("/login");
  }, [router]);

  if (loading) return <FullLoader />;
  if (!user) return null;

  return (
    <AppContext.Provider value={{ user, capabilities, logout, refreshCapabilities }}>
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
