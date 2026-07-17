import { describe, expect, it } from "vitest";

import {
  chatHref,
  knowledgeHref,
  normalizePathname,
  searchHref,
  sourceIdFromLocation,
  threadIdFromLocation,
} from "./client-route";

describe("normalizePathname", () => {
  it("去除静态导出的尾斜杠", () => {
    expect(normalizePathname("/chat/")).toBe("/chat");
    expect(normalizePathname("/chat")).toBe("/chat");
    expect(normalizePathname("/knowledge///")).toBe("/knowledge");
  });

  it("根路径保持原样", () => {
    expect(normalizePathname("/")).toBe("/");
  });
});

describe("href 构造", () => {
  it("chatHref 无线程时为裸路径", () => {
    expect(chatHref()).toBe("/chat");
    expect(chatHref(null)).toBe("/chat");
  });

  it("chatHref 对线程 ID 做 URL 编码", () => {
    expect(chatHref("t-1")).toBe("/chat?thread=t-1");
    expect(chatHref("a/b c")).toBe("/chat?thread=a%2Fb%20c");
  });

  it("knowledgeHref 同理", () => {
    expect(knowledgeHref()).toBe("/knowledge");
    expect(knowledgeHref("s-9")).toBe("/knowledge?source=s-9");
  });

  it("searchHref 组合 q 与 source", () => {
    expect(searchHref()).toBe("/search");
    expect(searchHref({ q: "你好 世界" })).toBe("/search?q=%E4%BD%A0%E5%A5%BD+%E4%B8%96%E7%95%8C");
    expect(searchHref({ source: "s-1" })).toBe("/search?source=s-1");
    expect(searchHref({ q: "x", source: "s-1" })).toBe("/search?q=x&source=s-1");
  });
});

describe("location 解析", () => {
  it("解析与构造互逆", () => {
    const href = chatHref("thread/9 x");
    const [pathname, search] = href.split("?");
    expect(threadIdFromLocation(pathname, `?${search}`)).toBe("thread/9 x");
  });

  it("尾斜杠路径同样命中", () => {
    expect(threadIdFromLocation("/chat/", "?thread=t-1")).toBe("t-1");
    expect(sourceIdFromLocation("/knowledge/", "?source=s-1")).toBe("s-1");
  });

  it("路径不匹配时返回 null（参数残留不误判）", () => {
    expect(threadIdFromLocation("/knowledge", "?thread=t-1")).toBeNull();
    expect(sourceIdFromLocation("/chat", "?source=s-1")).toBeNull();
    expect(threadIdFromLocation("/chat", "")).toBeNull();
  });
});
