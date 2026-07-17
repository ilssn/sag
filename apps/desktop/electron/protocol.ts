/**
 * sidecar JSONL 启动协议（ADR-0017）。
 * 解析保持宽容：未知事件/字段忽略；`ready` 校验 nonce + protocol + app_version。
 */

/** 壳支持的协议版本；`ready.protocol` 不一致视为终态错误。 */
export const PROTOCOL_VERSION = 1;

export interface SidecarEvent {
  v?: number;
  event: string;
  nonce?: string;
  status?: string;
  code?: string;
  message?: string;
  port?: number;
  app_version?: string;
  api_version?: string;
  protocol?: number;
  current?: number;
  total?: number;
  recoverable?: boolean;
  capabilities?: string[];
}

/** 终态错误码：出现即停止自动重启（ADR-0017）。 */
export const TERMINAL_ERROR_CODES = new Set([
  "port-conflict",
  "instance-already-running",
  "migration-failed",
  "engine-data-incompatible",
]);

export function isTerminalCode(code: string): boolean {
  return TERMINAL_ERROR_CODES.has(code);
}

export function parseLine(line: string): SidecarEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const event = value as Record<string, unknown>;
    if (typeof event.event !== "string") return null;
    return event as unknown as SidecarEvent;
  } catch {
    return null; // 非 JSONL 行（防御性忽略；正常后端 stdout 只承载协议）
  }
}
