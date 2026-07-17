/**
 * 运行时配置（ADR-0007）：API 地址等宿主信息不再编译进产物，
 * 而是在 UI 挂载前按以下优先级解析：
 *   1. 宿主注入的全局（Tauri 壳在页面脚本执行前通过 initialization_script 写入）
 *   2. 部署目录下的静态 /config.json（web 部署在容器启动时生成）
 *   3. 开发回退（保留「局域网访问自动指向同主机 :8000」的启发式）
 *
 * 业务代码一律通过 runtimeConfig()/apiBase() 读取；在启动门（AppBootstrap）
 * 完成前调用会直接抛错——模块顶层求值属于违规用法，构建期即可暴露。
 */

export interface RuntimeConfig {
  /** FastAPI 服务的绝对 origin，无尾斜杠，如 "http://127.0.0.1:8000"。 */
  apiBase: string;
  /** 仅 web 演示用的窗口缩放；桌面壳注入 false。 */
  enableWindowScaling: boolean;
  /** 宿主标识："desktop"（Tauri 壳）| "web"。缺省视为 web。 */
  host?: string;
  /** 宿主应用版本（桌面壳注入，用于诊断展示）。 */
  appVersion?: string;
  /** 预留能力开关（宿主声明能力，UI 不做环境嗅探）。 */
  flags?: Record<string, boolean>;
}

/** 跨宿主契约：Tauri 壳在页面加载前给该全局赋值。 */
export const RUNTIME_CONFIG_GLOBAL = "__SAG_RUNTIME_CONFIG__";
export const RUNTIME_CONFIG_URL = "/config.json";

const DEFAULT_API_PORT = 8000;
const DISABLED_FLAG_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

let current: RuntimeConfig | null = null;

export function runtimeConfig(): RuntimeConfig {
  if (!current) {
    throw new RuntimeConfigError(
      "runtimeConfig() called before bootstrap completed (ADR-0007: no module-scope or pre-gate reads)",
    );
  }
  return current;
}

export function apiBase(): string {
  return runtimeConfig().apiBase;
}

export function isRuntimeConfigReady(): boolean {
  return current !== null;
}

/** 仅测试使用。 */
export function __setRuntimeConfigForTests(next: RuntimeConfig | null): void {
  current = next;
}

interface LocationLike {
  protocol: string;
  hostname: string;
}

/** Tauri WebView origin：macOS 为 tauri://localhost，Windows 为 http(s)://tauri.localhost。 */
export function isTauriHostOrigin(loc: LocationLike): boolean {
  return loc.protocol === "tauri:" || loc.hostname === "tauri.localhost";
}

/**
 * 无任何配置时的回退：浏览器通过局域网 IP 打开前端时，自动指向同主机 :8000；
 * 本机（含 *.localhost，避免误改写 Tauri origin）保持 localhost:8000。
 */
export function defaultApiBase(loc: LocationLike): string {
  const isHttp = loc.protocol === "http:" || loc.protocol === "https:";
  const isLocal =
    loc.hostname === "localhost" ||
    loc.hostname === "127.0.0.1" ||
    loc.hostname.endsWith(".localhost");
  if (isHttp && !isLocal) return `${loc.protocol}//${loc.hostname}:${DEFAULT_API_PORT}`;
  return `http://localhost:${DEFAULT_API_PORT}`;
}

function coerceFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim() !== "") {
    return !DISABLED_FLAG_VALUES.has(value.trim().toLowerCase());
  }
  return fallback;
}

/**
 * 校验并归一宿主提供的原始配置。apiBase 缺失/留空表示「按部署主机自动推导」，
 * 其余非法形态（非对象、apiBase 非字符串等）一律抛 RuntimeConfigError——
 * 部署了坏配置必须响亮失败，而不是悄悄指向错误的 API。
 */
export function normalizeRuntimeConfig(
  raw: unknown,
  loc: LocationLike,
): RuntimeConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RuntimeConfigError("runtime config must be a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const flags =
    typeof record.flags === "object" && record.flags !== null && !Array.isArray(record.flags)
      ? (record.flags as Record<string, unknown>)
      : {};

  const rawApiBase = record.apiBase;
  if (rawApiBase !== undefined && rawApiBase !== null && typeof rawApiBase !== "string") {
    throw new RuntimeConfigError("apiBase must be a string");
  }
  const trimmedApiBase = typeof rawApiBase === "string" ? rawApiBase.trim() : "";
  const resolvedApiBase = (trimmedApiBase || defaultApiBase(loc)).replace(/\/+$/, "");

  const normalizedFlags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    normalizedFlags[key] = coerceFlag(value, false);
  }

  return {
    apiBase: resolvedApiBase,
    enableWindowScaling: coerceFlag(
      record.enableWindowScaling ?? flags.enableWindowScaling,
      true,
    ),
    host: typeof record.host === "string" ? record.host : undefined,
    appVersion: typeof record.appVersion === "string" ? record.appVersion : undefined,
    flags: normalizedFlags,
  };
}

function readInjectedConfig(): unknown {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL];
}

async function fetchDeployedConfig(): Promise<unknown | undefined> {
  let response: Response;
  try {
    response = await fetch(RUNTIME_CONFIG_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // 真实部署的网络抖动与「没有该文件」难以区分：回退默认值并留痕。
    console.warn("[runtime-config] failed to fetch /config.json, falling back to defaults", error);
    return undefined;
  }
  if (response.status === 404) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  // SPA 宿主可能把未知路径改写为 index.html：非 JSON 视为「没有部署配置」。
  if (!contentType.includes("json")) return undefined;
  if (!response.ok) {
    throw new RuntimeConfigError(`failed to read /config.json (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new RuntimeConfigError("/config.json is not valid JSON");
  }
}

/** 启动门专用：解析并缓存运行时配置。幂等，重复调用复用结果。 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (current) return current;
  if (typeof window === "undefined") {
    throw new RuntimeConfigError("runtime config can only be resolved in a browser context");
  }
  const loc = window.location;

  const injected = readInjectedConfig();
  if (injected !== undefined && injected !== null) {
    current = normalizeRuntimeConfig(injected, loc);
    return current;
  }

  // Tauri origin 下注入缺失说明壳启动链路损坏：硬失败进入错误界面，
  // 绝不能回退到 localhost:8000 而悄悄指向错误端口。
  if (isTauriHostOrigin(loc)) {
    throw new RuntimeConfigError(
      "desktop host did not inject runtime config (__SAG_RUNTIME_CONFIG__ missing)",
    );
  }

  const deployed = await fetchDeployedConfig();
  if (deployed !== undefined && deployed !== null) {
    current = normalizeRuntimeConfig(deployed, loc);
    return current;
  }

  current = {
    apiBase: defaultApiBase(loc),
    enableWindowScaling: true,
    flags: {},
  };
  return current;
}
