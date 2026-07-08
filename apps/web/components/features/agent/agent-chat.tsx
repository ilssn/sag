"use client";

import * as React from "react";

import { api } from "@/lib/api";
import { streamAgentAsk } from "@/lib/sse";
import {
  ConversationView,
  type ConvMessage,
} from "@/components/features/chat/conversation-view";

/** Agent 对话面板 —— 共享 ConversationView 的薄封装（头像 + 开场白）。 */
export function AgentChat({
  agentId,
  agentName,
  avatar,
  greeting,
  threadId,
  ensureThread,
  onActivity,
}: {
  agentId: string;
  agentName: string;
  avatar: string;
  greeting?: string;
  threadId: string | null;
  ensureThread: () => Promise<string>;
  onActivity?: () => void;
}) {
  const listMessages = React.useCallback(
    (tid: string): Promise<ConvMessage[]> => api.listMessages(agentId, tid),
    [agentId],
  );

  const stream = React.useCallback(
    (
      tid: string,
      query: string,
      handlers: Parameters<typeof streamAgentAsk>[3],
      signal: AbortSignal,
    ) => streamAgentAsk(agentId, tid, { query }, handlers, signal),
    [agentId],
  );

  const glyph = avatar || agentName.slice(0, 1);
  const avatarNode = React.useMemo(
    () => (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold-soft text-[11px] font-semibold text-gold-strong">
        {glyph}
      </span>
    ),
    [glyph],
  );
  const heroNode = React.useMemo(
    () => (
      <span className="grid size-12 place-items-center rounded-full bg-gold-soft font-display text-xl font-semibold text-gold-strong">
        {glyph}
      </span>
    ),
    [glyph],
  );

  return (
    <ConversationView
      conversationKey={agentId}
      threadId={threadId}
      listMessages={listMessages}
      stream={stream}
      ensureThread={ensureThread}
      onActivity={onActivity}
      avatarNode={avatarNode}
      heroNode={heroNode}
      emptyTitle={agentName}
      emptyHint={greeting || "开始对话吧。"}
      placeholder={`对 ${agentName} 说点什么…  Enter 发送 · Shift+Enter 换行`}
    />
  );
}
