import type { AgentEvent } from "./sse";
import type { Citation, MessageStep } from "./types";

export interface LiveStep extends MessageStep {
  id: string;
  status: "active" | "done" | "error";
  startedAt: number;
  progress?: string;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toolArguments(value: unknown): Record<string, unknown> {
  return objectValue(value);
}

export function toolArgumentsPreview(value: unknown, limit = 60): string {
  const text = Object.entries(toolArguments(value))
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => `${key}=${typeof item === "string" ? item : JSON.stringify(item)}`)
    .join("; ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isCitation(value: unknown): value is Citation {
  if (!value || typeof value !== "object") return false;
  const citation = value as Partial<Citation>;
  return (
    typeof citation.n === "number" &&
    Number.isFinite(citation.n) &&
    (citation.chunk_id === null || typeof citation.chunk_id === "string") &&
    typeof citation.heading === "string" &&
    typeof citation.snippet === "string" &&
    typeof citation.score === "number" &&
    Number.isFinite(citation.score) &&
    (citation.source_id === null || typeof citation.source_id === "string")
  );
}

export function citationsFromArtifacts(value: unknown): Citation[] {
  const citations = objectValue(value).citations;
  return Array.isArray(citations) ? citations.filter(isCitation) : [];
}

export function mergeCitations(current: Citation[], incoming: Citation[]): Citation[] {
  if (!incoming.length) return current;
  const byNumber = new Map(current.map((citation) => [citation.n, citation]));
  incoming.forEach((citation) => byNumber.set(citation.n, citation));
  return [...byNumber.values()].sort((left, right) => left.n - right.n);
}

function elapsed(step: LiveStep, now: number): number {
  return step.ms ?? Math.max(0, now - step.startedAt);
}

export function settleActiveSteps(
  steps: LiveStep[],
  now: number,
  status: "done" | "error" = "done",
  error?: string,
  exceptId?: string,
): LiveStep[] {
  let changed = false;
  const next = steps.map((step) => {
    if (step.status !== "active" || step.id === exceptId) return step;
    changed = true;
    return {
      ...step,
      status,
      ms: elapsed(step, now),
      error: error ?? step.error,
    };
  });
  return changed ? next : steps;
}

function settleActiveModelSteps(steps: LiveStep[], now: number): LiveStep[] {
  let changed = false;
  const next = steps.map((step) => {
    if (step.status !== "active" || step.kind === "tool") return step;
    changed = true;
    return { ...step, status: "done" as const, ms: elapsed(step, now) };
  });
  return changed ? next : steps;
}

function toolDetails(value: unknown): NonNullable<MessageStep["details"]> {
  return objectValue(value) as NonNullable<MessageStep["details"]>;
}

function numericDuration(value: unknown): number {
  const duration = Number(value ?? 0);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function upsertToolStep(steps: LiveStep[], event: AgentEvent, now: number): LiveStep[] {
  const payload = event.payload;
  const id = String(payload.tool_call_id ?? `tool-${event.turn}`);
  const argumentsValue = toolArguments(payload.arguments);
  const existingIndex = steps.findIndex((step) => step.id === id);
  if (existingIndex >= 0) {
    const existing = steps[existingIndex];
    const replacement: LiveStep = {
      ...existing,
      kind: "tool",
      name: String(payload.name ?? existing.name ?? ""),
      label: String(payload.label ?? existing.label ?? payload.name ?? "工具"),
      args: toolArgumentsPreview(argumentsValue) || existing.args,
      arguments: Object.keys(argumentsValue).length ? argumentsValue : existing.arguments,
      status: "active",
      error: undefined,
    };
    const next = [...steps];
    next[existingIndex] = replacement;
    return next;
  }
  return [
    ...steps,
    {
      id,
      kind: "tool",
      name: String(payload.name ?? ""),
      label: String(payload.label ?? payload.name ?? "工具"),
      args: toolArgumentsPreview(argumentsValue),
      arguments: argumentsValue,
      step: event.turn,
      status: "active",
      startedAt: now,
    },
  ];
}

function finishToolStep(
  steps: LiveStep[],
  event: AgentEvent,
  now: number,
  status: "done" | "error",
): LiveStep[] {
  const payload = event.payload;
  const id = String(payload.tool_call_id ?? `tool-${event.turn}`);
  const duration = numericDuration(payload.duration_ms);
  const failure = objectValue(payload.error);
  const details = toolDetails(payload.details);
  const existingIndex = steps.findIndex((step) => step.id === id);
  const replacement: LiveStep = {
    ...(existingIndex >= 0
      ? steps[existingIndex]
      : {
          id,
          kind: "tool" as const,
          step: event.turn,
          startedAt: Math.max(0, now - duration),
        }),
    name: String(payload.name ?? (existingIndex >= 0 ? steps[existingIndex].name ?? "" : "")),
    label: String(
      payload.label ??
        (existingIndex >= 0 ? steps[existingIndex].label : undefined) ??
        payload.name ??
        "工具",
    ),
    status,
    ms: duration,
    count: Number(details.count ?? 0),
    details,
    error: status === "error" ? String(failure.message ?? "工具执行失败") : undefined,
  };
  if (existingIndex < 0) return [...steps, replacement];
  const next = [...steps];
  next[existingIndex] = replacement;
  return next;
}

function startAnswerStep(steps: LiveStep[], event: AgentEvent, now: number): LiveStep[] {
  const activeAnswer = steps.find(
    (step) => step.kind === "answer" && step.step === event.turn && step.status === "active",
  );
  if (activeAnswer) return steps;

  const thinkingIndex = steps.findIndex(
    (step) => step.kind === "thinking" && step.step === event.turn && step.status === "active",
  );
  if (thinkingIndex >= 0) {
    const next = [...steps];
    next[thinkingIndex] = {
      ...steps[thinkingIndex],
      id: `answer-${event.turn}`,
      kind: "answer",
    };
    return next;
  }

  return [
    ...settleActiveSteps(steps, now),
    {
      id: `answer-${event.turn}`,
      kind: "answer",
      step: event.turn,
      status: "active",
      startedAt: now,
    },
  ];
}

function finishModelStep(steps: LiveStep[], event: AgentEvent, now: number): LiveStep[] {
  const payload = event.payload;
  const message = objectValue(payload.message);
  if (message.role !== "assistant") return steps;
  const kind: LiveStep["kind"] = payload.has_tool_calls ? "thinking" : "answer";
  const id = `${kind}-${event.turn}`;
  const duration = numericDuration(payload.duration_ms);
  const existingIndex = steps.findIndex(
    (step) => step.kind === kind && step.step === event.turn,
  );
  const replacement: LiveStep = {
    ...(existingIndex >= 0
      ? steps[existingIndex]
      : {
          id,
          kind,
          step: event.turn,
          startedAt: Math.max(0, now - duration),
        }),
    status: "done",
    ms: duration,
  };
  if (existingIndex < 0) return [...steps, replacement];
  const next = [...steps];
  next[existingIndex] = replacement;
  return next;
}

/**
 * Reduces observable Agent events into UI activity. It deliberately records
 * phases, tool inputs/results, and duration only; it never invents or exposes
 * a hidden chain of thought.
 */
export function reduceAgentRunSteps(
  steps: LiveStep[],
  event: AgentEvent,
  now = Date.now(),
): LiveStep[] {
  switch (event.type) {
    case "turn.started": {
      const settled = settleActiveSteps(steps, now);
      const id = `thinking-${event.turn}`;
      if (settled.some((step) => step.id === id)) return settled;
      return [
        ...settled,
        {
          id,
          kind: "thinking",
          step: event.turn,
          status: "active",
          startedAt: now,
        },
      ];
    }
    case "tool.approval_required":
    case "tool.started": {
      return upsertToolStep(settleActiveModelSteps(steps, now), event, now);
    }
    case "tool.progress": {
      const id = String(event.payload.tool_call_id ?? `tool-${event.turn}`);
      const index = steps.findIndex((step) => step.id === id);
      if (index < 0) return steps;
      const details = toolDetails(event.payload.details);
      const next = [...steps];
      next[index] = {
        ...steps[index],
        progress: String(event.payload.message ?? ""),
        details: { ...steps[index].details, ...details },
      };
      return next;
    }
    case "tool.completed":
      return finishToolStep(steps, event, now, "done");
    case "tool.failed":
      return finishToolStep(steps, event, now, "error");
    case "message.delta":
      return event.payload.role === "tool" ? steps : startAnswerStep(steps, event, now);
    case "message.completed":
      return finishModelStep(steps, event, now);
    case "run.completed":
      return settleActiveSteps(steps, now);
    case "run.cancelled":
      return settleActiveSteps(steps, now, "error", "已停止");
    case "run.failed": {
      const error = objectValue(event.payload.error);
      return settleActiveSteps(steps, now, "error", String(error.message ?? "生成失败"));
    }
    default:
      return steps;
  }
}
