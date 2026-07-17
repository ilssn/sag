import {
  defaultLocale,
  isAppLocale,
  localeCookieMaxAge,
  localeCookieName,
  localeFromAcceptLanguage,
  type AppLocale,
} from "./config";

function readCookieLocale(): AppLocale | null {
  const cookieLocale = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${localeCookieName}=`))
    ?.slice(localeCookieName.length + 1);
  const decoded = cookieLocale ? decodeURIComponent(cookieLocale) : null;
  return isAppLocale(decoded) ? decoded : null;
}

/** Read the currently active locale without coupling non-React code to next-intl hooks. */
export function readClientLocale(): AppLocale {
  if (typeof document === "undefined") return defaultLocale;
  const documentLocale = document.documentElement.lang;
  if (isAppLocale(documentLocale)) return documentLocale;
  return readCookieLocale() ?? defaultLocale;
}

/**
 * 启动门首帧的语言解析（静态导出下没有服务端协商）：
 * <html lang>（根布局内联脚本在首次绘制前写入）→ cookie → 浏览器语言 → 默认。
 * 复用 localeFromAcceptLanguage 保持与旧服务端协商同一套匹配规则。
 */
export function resolveInitialLocale(): AppLocale {
  if (typeof document === "undefined") return defaultLocale;
  const documentLocale = document.documentElement.lang;
  if (isAppLocale(documentLocale)) return documentLocale;
  const cookieLocale = readCookieLocale();
  if (cookieLocale) return cookieLocale;
  if (typeof navigator === "undefined") return defaultLocale;
  return localeFromAcceptLanguage(
    navigator.languages?.join(",") || navigator.language || null,
  );
}

/** Persist the locale for both the next server render and future visits. */
export function persistLocale(locale: AppLocale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure}`;
  document.documentElement.lang = locale;
}
