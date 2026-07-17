"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  sourceIdFromLocation,
  threadIdFromLocation,
} from "@/lib/client-route";

export interface UrlLocation {
  pathname: string;
  search: string;
}

/**
 * 合流两类地址变化：Next 路由钩子（push/replace 导航）与
 * history.replaceState + `sag:pathchange` 广播（新会话接管 URL 不打断流式，
 * 前端规范要求的模式）。调用方需位于 <React.Suspense> 边界内（useSearchParams 要求）。
 */
export function useUrlLocation(): UrlLocation {
  const routePathname = usePathname();
  const routeSearchParams = useSearchParams();
  const routeSearch = routeSearchParams.toString();
  const [location, setLocation] = React.useState<UrlLocation>(() => ({
    pathname: routePathname,
    search: routeSearch ? `?${routeSearch}` : "",
  }));

  React.useEffect(() => {
    setLocation({
      pathname: routePathname,
      search: routeSearch ? `?${routeSearch}` : "",
    });
  }, [routePathname, routeSearch]);

  React.useEffect(() => {
    const sync = () =>
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    window.addEventListener("sag:pathchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("sag:pathchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return location;
}

/** 当前 URL 指向的会话线程（/chat?thread=…），不在对话区时为 null。 */
export function useRouteThreadId(): string | null {
  const { pathname, search } = useUrlLocation();
  return threadIdFromLocation(pathname, search);
}

/** 当前 URL 指向的信源详情（/knowledge?source=…），不在详情时为 null。 */
export function useRouteSourceId(): string | null {
  const { pathname, search } = useUrlLocation();
  return sourceIdFromLocation(pathname, search);
}
