"use client";

/**
 * 宠物活动模型（自 pet.tsx 抽离的纯层）：会话快照 → 宠物状态派生，
 * 以及摆位避让矩形采集。不含 React 状态；hook 接线仍留在组件。
 */

import type { ConversationSessionSnapshot } from "@/lib/conversation-runtime";
import type { PetAgentActivity } from "@/lib/pet-agent";

export type PetVisualMode = PetAgentActivity | "jumping" | "flying" | "roaming" | "dancing";
export type PetFormTransition = "idle" | "bursting" | "falling" | "launching";

export interface PetActivity {
  streaming: boolean;
  mode: Exclude<PetAgentActivity, "done">;
  label: string;
  threadId: string | null;
  runKey: string | null;
  failed: boolean;
}

export function visiblePlacementAvoidRects() {
  return [...document.querySelectorAll<HTMLElement>("[data-universe-controls]")]
    .filter((element) => element.offsetParent !== null)
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    });
}

export function deriveActivity(
  state: ConversationSessionSnapshot | null,
  labels: { thinking: string; answering: string; working: string },
): PetActivity {
  const steps = state?.run?.steps ?? [];
  const active = [...steps].reverse().find((step) => step.status === "active");
  const failed = Boolean(state?.error) && !state?.run;

  if (!state?.run) {
    return {
      streaming: false,
      mode: failed ? "error" : "idle",
      label: "",
      threadId: state?.threadId ?? null,
      runKey: null,
      failed,
    };
  }
  if (!active || active.kind === "thinking") {
    return {
      streaming: true,
      mode: "thinking",
      label: labels.thinking,
      threadId: state.threadId,
      runKey: `${state.sessionId}:${state.run.requestId}`,
      failed,
    };
  }
  if (active.kind === "answer") {
    return {
      streaming: true,
      mode: "answering",
      label: labels.answering,
      threadId: state.threadId,
      runKey: `${state.sessionId}:${state.run.requestId}`,
      failed,
    };
  }
  return {
    streaming: true,
    mode: "working",
    label: active.label || active.name || labels.working,
    threadId: state.threadId,
    runKey: `${state.sessionId}:${state.run.requestId}`,
    failed,
  };
}
