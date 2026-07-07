import "./globals.css";

import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { fontVars } from "./fonts";

export const metadata: Metadata = {
  title: "muse · 知识库",
  description: "从信息源到知识问答 · 开源知识库平台",
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
