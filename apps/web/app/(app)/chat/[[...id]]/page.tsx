"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { DEFAULT_AGENT_AVATAR } from "@/lib/branding";
import { streamAgentAsk } from "@/lib/sse";
import { useApp } from "@/components/features/app-shell";
import {
  ConversationView,
  type ConvMessage,
} from "@/components/features/chat/conversation-view";
import { PetHeadAvatar } from "@/components/features/pet-head-avatar";

/** 对话 —— 产品主入口：默认 agent + 会话（/chat 新会话，/chat/[id] 续聊）。 */
export default function ChatPage() {
  const { id } = useParams<{ id?: string[] }>();
  const router = useRouter();
  const { agent, refreshThreads } = useApp();
  const routeThreadId = id?.[0] ?? null;
  const [draftThreadId, setDraftThreadId] = React.useState<string | null>(null);
  const [draftNonce, setDraftNonce] = React.useState(0);
  const threadId = routeThreadId ?? draftThreadId;
  // 本页新建的线程接管 URL 时保持组件实例；真正切换到其他线程才重新挂载。
  const conversationViewKey =
    routeThreadId && routeThreadId !== draftThreadId
      ? routeThreadId
      : `new-${draftNonce}`;

  React.useEffect(() => {
    const onNewChat = () => {
      setDraftThreadId(null);
      setDraftNonce((n) => n + 1);
      if (window.location.pathname !== "/chat") router.push("/chat");
    };
    window.addEventListener("sag:new-chat", onNewChat);
    return () => window.removeEventListener("sag:new-chat", onNewChat);
  }, [router]);

  React.useEffect(() => {
    // 兼容任何直接导航到 /chat 的入口，不让刚创建过的线程泄漏到新草稿页。
    if (!routeThreadId && window.location.pathname === "/chat") {
      setDraftThreadId(null);
    }
  }, [routeThreadId]);

  const listMessages = React.useCallback(
    (tid: string): Promise<ConvMessage[]> =>
      agent ? api.listMessages(agent.id, tid) : Promise.resolve([]),
    [agent],
  );

  const stream = React.useCallback(
    (
      tid: string,
      query: string,
      onEvent: Parameters<typeof streamAgentAsk>[3],
      signal: AbortSignal,
      attachments?: string[],
      sourceIds?: string[],
    ) => {
      if (!agent) return Promise.reject(new Error("agent 未就绪"));
      return streamAgentAsk(
        agent.id,
        tid,
        { query, attachments, source_ids: sourceIds },
        onEvent,
        signal,
      );
    },
    [agent],
  );

  const ensureThread = React.useCallback(async () => {
    if (!agent) throw new Error("agent 未就绪");
    if (threadId) return threadId;
    const t = await api.createThread(agent.id);
    setDraftThreadId(t.id);
    // 原生 history 避免中断刚启动的流；本地 thread 状态负责后续连续对话。
    window.history.replaceState(window.history.state, "", `/chat/${t.id}`);
    window.dispatchEvent(new Event("sag:pathchange"));
    refreshThreads();
    return t.id;
  }, [agent, threadId, refreshThreads]);

  const glyph = agent?.avatar || DEFAULT_AGENT_AVATAR;
  const avatarNode = React.useMemo(
    () => <PetHeadAvatar face={glyph} size="sm" className="mt-0.5" />,
    [glyph],
  );
  const heroNode = React.useMemo(
    () => <PetHeadAvatar face={glyph} size="lg" />,
    [glyph],
  );

  if (!agent) return null;

  return (
    <div className="h-full min-h-0">
      <ConversationView
        key={conversationViewKey}
        conversationKey={agent.id}
        threadId={threadId}
        listMessages={listMessages}
        deleteMessage={(tid, mid) => (agent ? api.deleteMessage(agent.id, tid, mid) : Promise.resolve())}
        stream={stream}
        cancelRun={(tid, runId) => api.cancelAgentRun(agent.id, tid, runId)}
        approveTool={(tid, runId, toolCallId) =>
          api.approveAgentTool(agent.id, tid, runId, toolCallId)
        }
        rejectTool={(tid, runId, toolCallId, reason) =>
          api.rejectAgentTool(agent.id, tid, runId, toolCallId, reason)
        }
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
