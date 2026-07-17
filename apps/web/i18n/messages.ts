import type { AbstractIntlMessages } from "next-intl";

import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";

import type { AppLocale } from "./config";

/**
 * 双词典静态打包（每份 gzip 后约 16KB）：换来语言解析全同步、切换零加载、
 * 启动错误界面必有可用文案。静态导出下没有服务端按需装载可用（ADR-0006）。
 */
export const MESSAGES: Record<AppLocale, AbstractIntlMessages> = {
  "zh-CN": zhCN as AbstractIntlMessages,
  "en-US": enUS as AbstractIntlMessages,
};
