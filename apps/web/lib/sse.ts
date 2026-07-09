import { API_BASE } from "./api";
import { getToken } from "./auth";
import type { Citation } from "./types";

export interface AskHandlers {
  onStatus?: (step: number) => void;
  onTool?: (name: string, step?: number, args?: string) => void;
  onToolResult?: (r: { name: string; step?: number; ms?: number; count?: number }) => void;
  onMeta?: (citations: Citation[], promptPreview?: string) => void;
  onToken?: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: (messageId: string) => void;
}

/**
 * 通过 fetch 消费 SSE 流（因 ask 是带鉴权的 POST，原生 EventSource 无法胜任）。
 */
async function streamPost(
  path: string,
  body: Record<string, unknown>,
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = "生成失败";
    try {
      const j = await res.json();
      message = j?.error?.message || j?.detail || message;
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    const lines = frame.split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "meta")
      handlers.onMeta?.((payload.citations as Citation[]) || [], payload.prompt_preview as string);
    else if (event === "token") handlers.onToken?.((payload.text as string) || "");
    else if (event === "error") handlers.onError?.((payload.message as string) || "生成失败");
    else if (event === "done") handlers.onDone?.((payload.message_id as string) || "");
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.trim()) dispatch(frame);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

export function streamAgentAsk(
  agentId: string,
  threadId: string,
  body: { query: string; attachments?: string[]; source_ids?: string[]; mode?: "agentic" | "fast" },
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamPost(`/api/v1/agents/${agentId}/threads/${threadId}/ask`, body, handlers, signal);
}
