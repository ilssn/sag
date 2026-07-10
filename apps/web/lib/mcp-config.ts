export type McpConnectionMode = "http" | "stdio";

export interface ParsedMcpServer {
  name: string;
  mode: McpConnectionMode;
  config: Record<string, unknown>;
}

export interface ParsedMcpConfig {
  servers: ParsedMcpServer[];
  skipped: string[];
}

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function looksLikeServer(value: unknown): value is JsonRecord {
  return isRecord(value) && ["url", "command"].some((key) => typeof value[key] === "string");
}

function stringMap(value: unknown, field: string, name: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new McpConfigError(`服务「${name}」的 ${field} 必须是 JSON 对象`);
  }
  const entries = Object.entries(value).map(([key, item]) => {
    if (!["string", "number", "boolean"].includes(typeof item)) {
      throw new McpConfigError(`服务「${name}」的 ${field}.${key} 必须是字符串或数字`);
    }
    return [key, String(item)] as const;
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function splitArgs(value: string): string[] {
  const tokens = value.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
  return tokens.map((token) => {
    const quoted =
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"));
    const unwrapped = quoted ? token.slice(1, -1) : token;
    return unwrapped.replace(/\\([\\"])/g, "$1");
  });
}

function argsList(value: unknown, name: string): string[] | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const parsed = splitArgs(value);
    return parsed.length ? parsed : undefined;
  }
  if (!Array.isArray(value)) {
    throw new McpConfigError(`服务「${name}」的 args 必须是数组或字符串`);
  }
  const parsed = value.map((item) => {
    if (!["string", "number", "boolean"].includes(typeof item)) {
      throw new McpConfigError(`服务「${name}」的 args 只能包含字符串或数字`);
    }
    return String(item);
  });
  return parsed.length ? parsed : undefined;
}

function serverEntries(root: unknown): Array<[string, JsonRecord]> {
  if (Array.isArray(root)) {
    return root.map((item, index) => {
      if (!isRecord(item)) {
        throw new McpConfigError(`第 ${index + 1} 个服务配置不是 JSON 对象`);
      }
      const name = typeof item.name === "string" ? item.name.trim() : "";
      return [name || `MCP 服务 ${index + 1}`, item];
    });
  }
  if (!isRecord(root)) {
    throw new McpConfigError("MCP 配置必须是 JSON 对象");
  }

  const container = root.mcpServers ?? root.servers;
  if (container !== undefined) {
    if (Array.isArray(container)) return serverEntries(container);
    if (!isRecord(container)) {
      throw new McpConfigError("mcpServers（或 servers）必须是 JSON 对象");
    }
    return Object.entries(container).map(([name, config]) => {
      if (!isRecord(config)) {
        throw new McpConfigError(`服务「${name}」的配置必须是 JSON 对象`);
      }
      return [name, config];
    });
  }

  if (looksLikeServer(root)) {
    const name = typeof root.name === "string" ? root.name.trim() : "";
    return [[name || "MCP 服务", root]];
  }

  const entries = Object.entries(root);
  if (entries.length && entries.every(([, value]) => isRecord(value))) {
    return entries.map(([name, value]) => [name, value as JsonRecord]);
  }
  throw new McpConfigError("没有识别到 MCP 服务，请检查是否包含 url 或 command");
}

function normalizeServer(rawName: string, raw: JsonRecord): ParsedMcpServer | null {
  const name = rawName.trim() || (typeof raw.name === "string" ? raw.name.trim() : "");
  if (!name) throw new McpConfigError("每个 MCP 服务都需要名称");
  if (raw.disabled === true || raw.enabled === false) return null;

  const transport = String(raw.type ?? raw.transport ?? "").toLowerCase();
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  const prefersStdio = transport.includes("stdio") || transport.includes("local");
  const prefersHttp = transport.includes("http") || transport.includes("sse");
  const mode: McpConnectionMode = prefersStdio ? "stdio" : prefersHttp || url ? "http" : "stdio";

  if (mode === "http") {
    if (!url) throw new McpConfigError(`服务「${name}」缺少 url`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new McpConfigError(`服务「${name}」的 url 不是有效地址`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new McpConfigError(`服务「${name}」仅支持 HTTP 或 HTTPS 地址`);
    }
    const headers = stringMap(raw.headers, "headers", name);
    return {
      name,
      mode,
      config: { name, url, ...(headers ? { headers } : {}) },
    };
  }

  if (!command) throw new McpConfigError(`服务「${name}」缺少 command`);
  const args = argsList(raw.args, name);
  const env = stringMap(raw.env, "env", name);
  return {
    name,
    mode,
    config: { name, command, ...(args ? { args } : {}), ...(env ? { env } : {}) },
  };
}

/** 解析 Claude Desktop、Cursor、VS Code 与单服务形式的 MCP JSON。 */
export function parseMcpConfig(value: string): ParsedMcpConfig {
  const source = stripCodeFence(value);
  if (!source) return { servers: [], skipped: [] };

  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    throw new McpConfigError("JSON 格式不完整，请检查括号、引号和逗号");
  }

  const skipped: string[] = [];
  const servers = serverEntries(root).flatMap(([name, raw]) => {
    const normalized = normalizeServer(name, raw);
    if (normalized) return [normalized];
    skipped.push(name);
    return [];
  });
  const duplicate = servers.find(
    (server, index) =>
      servers.findIndex((candidate) => candidate.name.toLowerCase() === server.name.toLowerCase()) !==
      index,
  );
  if (duplicate) throw new McpConfigError(`服务名称「${duplicate.name}」重复`);
  if (!servers.length && skipped.length) {
    throw new McpConfigError("配置中的 MCP 服务均处于停用状态");
  }
  if (!servers.length) throw new McpConfigError("没有识别到可挂载的 MCP 服务");
  return { servers, skipped };
}
