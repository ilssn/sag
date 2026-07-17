"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { getToken } from "@/lib/auth";
import { LOGIN_PATH, chatHref } from "@/lib/client-route";

/** 静态导出下没有 middleware："/" 由客户端按登录态分发（替代旧 middleware 重定向）。 */
export default function IndexPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(getToken() ? chatHref() : LOGIN_PATH);
  }, [router]);
  return null; // 启动门的 Splash 仍在屏上，无需额外渲染
}
