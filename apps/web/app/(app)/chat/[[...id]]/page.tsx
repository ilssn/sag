"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { streamAgentAsk } from "@/lib/sse";
import { useApp } from "@/components/features/app-shell";
import {
  ConversationView,
  type ConvMessage,
} from "@/components/features/chat/conversation-view";

/** 对话 —— 产品主入口：默认 agent + 会话（/chat 新会话，/chat/[id] 续聊）。 */
export default function ChatPage() {
  const { id } = useParams<{ id?: string[] }>();
  const router = useRouter();
  const { agent, refreshThreads } = useApp();
  const threadId = id?.[0] ?? null;
  const [draftNonce, setDraftNonce] = React.useState(0);

  React.useEffect(() => {
    const onNewChat = () => {
      setDraftNonce((n) => n + 1);
      if (window.location.pathname !== "/chat") router.push("/chat");
    };
    window.addEventListener("sag:new-chat", onNewChat);
    return () => window.removeEventListener("sag:new-chat", onNewChat);
  }, [router]);

  const listMessages = React.useCallback(
    (tid: string): Promise<ConvMessage[]> =>
      agent ? api.listMessages(agent.id, tid) : Promise.resolve([]),
    [agent],
  );

  const stream = React.useCallback(
    (
      tid: string,
      query: string,
      handlers: Parameters<typeof streamAgentAsk>[3],
      signal: AbortSignal,
      attachments?: string[],
      sourceIds?: string[],
    ) => {
      if (!agent) return Promise.resolve();
      return streamAgentAsk(
        agent.id,
        tid,
        { query, attachments, source_ids: sourceIds },
        handlers,
        signal,
      );
    },
    [agent],
  );

  const ensureThread = React.useCallback(async () => {
    if (!agent) throw new Error("agent 未就绪");
    if (threadId) return threadId;
    const t = await api.createThread(agent.id);
    // 无刷新接管路由（保持组件状态），并让侧栏出现新会话
    window.history.replaceState(null, "", `/chat/${t.id}`);
    window.dispatchEvent(new Event("sag:pathchange"));
    refreshThreads();
    return t.id;
  }, [agent, threadId, refreshThreads]);

  const glyph = agent?.avatar || "s";
  const avatarNode = React.useMemo(
    () => (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
        {glyph}
      </span>
    ),
    [glyph],
  );
  const heroNode = React.useMemo(
    () => (
      <span className="relative grid size-12 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/85 font-display text-xl font-semibold text-primary-foreground shadow-lift">
        <span
          aria-hidden
          className="absolute -inset-3 -z-10 rounded-full bg-primary/10 blur-xl"
        />
        {glyph}
      </span>
    ),
    [glyph],
  );

  if (!agent) return null;

  return (
    <div className="h-full min-h-0">
      <ConversationView
        key={threadId ?? `new-${draftNonce}`}
        conversationKey={agent.id}
        threadId={threadId}
        listMessages={listMessages}
        deleteMessage={(tid, mid) => (agent ? api.deleteMessage(agent.id, tid, mid) : Promise.resolve())}
        stream={stream}
        ensureThread={ensureThread}
        onActivity={refreshThreads}
        avatarNode={avatarNode}
        heroNode={heroNode}
        emptyTitle={agent.name}
        suggestions={[
          "总结一下知识库里最重要的内容",
          "这份资料的关键结论是什么？",
          "帮我梳理其中的时间线",
        ]}
        emptyHint={agent.persona?.greeting || "我在。上传资料到知识库，或直接问我任何问题。"}
        placeholder={`向 ${agent.name} 发送消息，输入 @ 指定知识库`}
      />
    </div>
  );
}
