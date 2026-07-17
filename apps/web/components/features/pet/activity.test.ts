import { describe, expect, it } from "vitest";

import type { ConversationSessionSnapshot } from "@/lib/conversation-runtime";
import { deriveActivity } from "./activity";

const LABELS = { thinking: "思考中", answering: "作答中", working: "检索中" };

function snapshot(partial: Partial<ConversationSessionSnapshot>): ConversationSessionSnapshot {
  return {
    sessionId: "s1",
    threadId: "t1",
    ...partial,
  } as ConversationSessionSnapshot;
}

describe("deriveActivity（会话快照 → 宠物状态）", () => {
  it("无运行:空闲", () => {
    const activity = deriveActivity(snapshot({ run: undefined }), LABELS);
    expect(activity).toMatchObject({ streaming: false, mode: "idle", runKey: null, failed: false });
  });

  it("无运行但有错误:error 态", () => {
    const activity = deriveActivity(
      snapshot({ run: undefined, error: "boom" } as never),
      LABELS,
    );
    expect(activity.mode).toBe("error");
    expect(activity.failed).toBe(true);
  });

  it("运行中无活跃步骤:thinking", () => {
    const activity = deriveActivity(
      snapshot({ run: { requestId: "r1", steps: [] } } as never),
      LABELS,
    );
    expect(activity).toMatchObject({
      streaming: true,
      mode: "thinking",
      label: LABELS.thinking,
      runKey: "s1:r1",
    });
  });

  it("活跃 answer 步骤:answering", () => {
    const activity = deriveActivity(
      snapshot({
        run: { requestId: "r1", steps: [{ kind: "answer", status: "active" }] },
      } as never),
      LABELS,
    );
    expect(activity.mode).toBe("answering");
    expect(activity.label).toBe(LABELS.answering);
  });

  it("活跃工具步骤:working,标签取步骤名", () => {
    const activity = deriveActivity(
      snapshot({
        run: {
          requestId: "r1",
          steps: [
            { kind: "tool", status: "done", label: "旧" },
            { kind: "tool", status: "active", label: "检索知识库" },
          ],
        },
      } as never),
      LABELS,
    );
    expect(activity.mode).toBe("working");
    expect(activity.label).toBe("检索知识库");
  });

  it("null 快照:空闲且无线程", () => {
    const activity = deriveActivity(null, LABELS);
    expect(activity).toMatchObject({ mode: "idle", threadId: null });
  });
});
