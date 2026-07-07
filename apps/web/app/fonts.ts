import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";

// 正文：人文无衬线
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// 品牌 / 标题：光学可变衬线，灵动优雅
export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

// 代码 / 引用
export const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

export const fontVars = `${inter.variable} ${fraunces.variable} ${jbmono.variable}`;
