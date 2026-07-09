"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquarePlus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";

/**
 * 桌面宠物 —— 右下角可拖动的品牌小形象（可在 设置→外观 关闭）。
 * 纯 CSS 形象（渐变方脸 + 眨眼），点击弹快捷气泡；位置持久化。
 */
export function Pet() {
  const { agent } = useApp();
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const elRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sag:pet-pos");
      if (saved) setPos(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    el.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - 64);
    const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - 64);
    setPos({ x, y });
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && pos) {
      window.localStorage.setItem("sag:pet-pos", JSON.stringify(pos));
    } else if (d && !d.moved) {
      setOpen((v) => !v);
    }
  }

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : {};

  return (
    <div
      ref={elRef}
      className="fixed bottom-6 right-6 z-40 select-none"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-44 animate-fade-in rounded-lg border bg-card p-2 shadow-lift">
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {agent?.persona?.greeting || "我在。今天想理清什么？"}
          </p>
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <MessageSquarePlus className="size-3.5" />
            新对话
          </Link>
          <Link
            href="/search"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <Search className="size-3.5" />
            搜索知识库
          </Link>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => {
              window.localStorage.setItem("sag:pet", "off");
              window.dispatchEvent(new Event("sag:pet-toggle"));
            }}
          >
            <X className="size-3.5" />
            隐藏宠物（设置可恢复）
          </button>
        </div>
      )}
      <div
        role="button"
        aria-label={agent?.name || "sag"}
        title={agent?.name || "sag"}
        className={cn(
          "sag-pet grid size-12 cursor-grab place-items-center rounded-[14px] border bg-gradient-to-br from-primary to-primary/80 shadow-lift ring-1 ring-foreground/10 transition-transform active:cursor-grabbing",
          !pos && "hover:-translate-y-0.5",
        )}
      >
        <span className="flex gap-1.5">
          <span className="sag-pet-eye" />
          <span className="sag-pet-eye" />
        </span>
        <span className="sag-pet-mouth" />
      </div>
    </div>
  );
}

/** 宠物开关（localStorage sag:pet，默认开）。 */
export function usePetEnabled(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(true);
  React.useEffect(() => {
    const sync = () => setOn(window.localStorage.getItem("sag:pet") !== "off");
    sync();
    window.addEventListener("sag:pet-toggle", sync);
    return () => window.removeEventListener("sag:pet-toggle", sync);
  }, []);
  const set = React.useCallback((v: boolean) => {
    window.localStorage.setItem("sag:pet", v ? "on" : "off");
    window.dispatchEvent(new Event("sag:pet-toggle"));
  }, []);
  return [on, set];
}
