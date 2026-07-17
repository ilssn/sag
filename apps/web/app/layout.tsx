import "./globals.css";

import type { Metadata } from "next";

import zhCN from "@/messages/zh-CN.json";
import { PRODUCT_NAME } from "@/lib/branding";
import { AppBootstrap } from "@/components/app-bootstrap";
import { Providers } from "@/components/providers";
import { defaultLocale } from "@/i18n/config";
import { fontVars } from "./fonts";

// 静态导出只有一份 HTML，元数据取默认语言（应用登录后使用，SEO 无诉求）。
export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: zhCN.Metadata.description,
};

/**
 * 首次绘制前把 <html lang> 修正为 cookie/浏览器语言（与 i18n/config 的匹配规则一致），
 * 让 readClientLocale() 在启动门之前就返回正确语言（早期 API 请求的 Accept-Language 依赖它）。
 */
const LOCALE_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )sag_locale=([^;]*)/);var l=m?decodeURIComponent(m[1]):"";if(l!=="zh-CN"&&l!=="en-US"){var n=(navigator.languages&&navigator.languages[0])||navigator.language||"";l=/^zh/i.test(n)?"zh-CN":/^en/i.test(n)?"en-US":"zh-CN";}document.documentElement.lang=l;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={defaultLocale} suppressHydrationWarning className={fontVars}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
        <Providers>
          <AppBootstrap>{children}</AppBootstrap>
        </Providers>
      </body>
    </html>
  );
}
