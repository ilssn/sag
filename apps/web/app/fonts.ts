import localFont from "next/font/local";

// 字体本地化（离线可复现构建；来源与许可见 app/fonts/README.md）。
// 正文与标题统一无衬线（Notion/Codex 风）；标题用紧字距 .font-display 区分
export const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

// 代码 / 数据
export const jbmono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jbmono",
  display: "swap",
  weight: "100 800",
});

export const fontVars = `${inter.variable} ${jbmono.variable}`;
