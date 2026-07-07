"use client";

import * as React from "react";

import { api } from "@/lib/api";
import { streamAsk } from "@/lib/sse";
import {
  ConversationView,
  type ConvMessage,
} from "@/components/features/chat/conversation-view";

/** 知识库问答面板 —— 共享 ConversationView 的薄封装。 */
export function ChatPanel({
  sourceId,
  sourceName,
  threadId,
  ensureThread,
  onActivity,
}: {
  sourceId: string;
  sourceName: string;
  threadId: string | null;
  ensureThread: () => Promise<string>;
  onActivity?: () => void;
}) {
  const listMessages = React.useCallback(
    (tid: string): Promise<ConvMessage[]> => api.listMessages(sourceId, tid),
    [sourceId],
  );

  const stream = React.useCallback(
    (tid: string, query: string, handlers: Parameters<typeof streamAsk>[3], signal: AbortSignal) =>
      streamAsk(sourceId, tid, { query }, handlers, signal),
    [sourceId],
  );

  const avatarNode = React.useMemo(
    () => (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] bg-gold text-[12px] font-bold text-[#1b1a17]">
        m
      </span>
    ),
    [],
  );
  const heroNode = React.useMemo(
    () => (
      <span className="grid size-10 place-items-center rounded-[10px] bg-gold text-lg font-bold text-[#1b1a17]">
        m
      </span>
    ),
    [],
  );

  return (
    <ConversationView
      conversationKey={sourceId}
      threadId={threadId}
      listMessages={listMessages}
      stream={stream}
      ensureThread={ensureThread}
      onActivity={onActivity}
      avatarNode={avatarNode}
      heroNode={heroNode}
      emptyTitle={`就「${sourceName}」提问`}
      emptyHint="muse 会在该知识库中检索相关段落，并据此生成带引用的回答。"
    />
  );
}
