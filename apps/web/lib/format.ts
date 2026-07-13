export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export function parseUtcDate(value: string): Date {
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasZone || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function withTimeZone(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      ...options,
      timeZone: DEFAULT_TIME_ZONE,
    });
  }
}

export function formatDate(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return withTimeZone("UTC", options).format(new Date(`${value.trim()}T00:00:00Z`));
  }
  const date = parseUtcDate(value);
  return Number.isNaN(date.getTime()) ? "" : withTimeZone(timeZone, options).format(date);
}

export function formatDateTime(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return formatDate(value, timeZone, { dateStyle: "medium", timeStyle: "medium" });
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function relativeTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const then = parseUtcDate(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return formatDate(iso, timeZone);
}
