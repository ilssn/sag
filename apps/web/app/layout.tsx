import "./globals.css";

import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { fontVars } from "./fonts";

export const metadata: Metadata = {
  title: "sag",
  description: "上传信息，创建助手，带引用对话 · 开源知识助手平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={fontVars}>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
