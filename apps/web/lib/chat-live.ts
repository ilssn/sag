"use client";

import * as React from "react";

/**
 * 流式会话镜像 —— 模块级单例。
 * 网络请求本就不随组件卸载中断（无 unmount abort，答案始终完整落库）；
 * 本模块把「进行中的流」镜像出来，使：
 * 1) 切走再回来能接上正在生成的内容（adopt）；
 * 2) 侧栏会话项能显示生成中角标。
 */

export interface ChatLiveState {
  threadId: string | null;
  streaming: boolean;
  /** 已累计的助手文本（adopt 时作为初始内容） */
  content: string;
  citations: unknown[];
  /** 每次开始自增，供 adopt 去重 */
  session: number;
}

let state: ChatLiveState = {
  threadId: null,
  streaming: false,
  content: "",
  citations: [],
  session: 0,
};

const subs = new Set<() => void>();
function emit() {
  for (const fn of subs) fn();
}

export const chatLive = {
  get: (): ChatLiveState => state,
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  start(threadId: string) {
    state = { threadId, streaming: true, content: "", citations: [], session: state.session + 1 };
    emit();
    return state.session;
  },
  token(text: string, session = state.session) {
    if (session !== state.session) return;
    if (!state.streaming) return;
    state = { ...state, content: state.content + text };
    emit();
  },
  meta(citations: unknown[], session = state.session) {
    if (session !== state.session) return;
    if (!state.streaming) return;
    state = { ...state, citations };
    emit();
  },
  end(session = state.session) {
    if (session !== state.session) return;
    if (!state.streaming && state.threadId === null) return;
    state = { ...state, streaming: false };
    emit();
  },
};

/** 订阅镜像（useSyncExternalStore，SSR 安全）。 */
export function useChatLive(): ChatLiveState {
  return React.useSyncExternalStore(chatLive.subscribe, chatLive.get, chatLive.get);
}
