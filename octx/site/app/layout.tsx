import type { Metadata } from "next";
import "@/app/globals.css";
import { SiteHeader } from "@/components/site-header";
import { getSearchItems } from "@/lib/docs";

export const metadata: Metadata = {
  title: {
    default: "OCTX · Open Context Asset Format",
    template: "%s · OCTX",
  },
  description: "可创建、传播、校验并直接复用的开放上下文资产格式。",
  keywords: ["OCTX", "Open Context Asset Format", "Agent Context", "SAG", "OKF"],
  icons: { icon: "/octx-mark.svg" },
  openGraph: {
    title: "OCTX · Open Context Asset Format",
    description: "Build context once. Carry its meaning everywhere.",
    type: "website",
  },
};

const themeScript = `
(() => {
  try {
    const saved = localStorage.getItem('octx-theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (_) {}
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const searchItems = getSearchItems();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <SiteHeader searchItems={searchItems} />
        {children}
      </body>
    </html>
  );
}
