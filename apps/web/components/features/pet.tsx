"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquarePlus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";

/**
 * 桌面宠物「小宇航员」—— 视口级左下角（不受应用窗口约束），可拖动、可关闭。
 * 头盔面罩里是可自定义的 emoji 表情（预设集，localStorage 持久化）。
 */

const EMOJIS = ["🙂", "😄", "🤖", "🐱", "🦊", "😎", "🫡", "✨"] as const;

export function Pet() {
  const { agent } = useApp();
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = React.useState(false);
  const [emoji, setEmoji] = React.useState<string>("🙂");
  const dragRef = React.useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const elRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sag:pet-pos");
      if (saved) setPos(JSON.parse(saved));
      const face = window.localStorage.getItem("sag:pet-emoji");
      if (face) setEmoji(face);
    } catch {
      /* ignore */
    }
  }, []);

  function pickEmoji(e: string) {
    setEmoji(e);
    window.localStorage.setItem("sag:pet-emoji", e);
  }
  function hide() {
    window.localStorage.setItem("sag:pet", "off");
    window.dispatchEvent(new Event("sag:pet-toggle"));
  }

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
    const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - 72);
    const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - 72);
    setPos({ x, y });
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && pos) window.localStorage.setItem("sag:pet-pos", JSON.stringify(pos));
    else if (d && !d.moved) setOpen((v) => !v);
  }

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : {};

  return (
    <div
      ref={elRef}
      className="group/pet fixed bottom-6 left-6 z-40 select-none"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="absolute bottom-full left-0 mb-2 w-52 rounded-lg border bg-card p-2 shadow-lift"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {agent?.persona?.greeting || "我在。今天想理清什么？"}
            </p>
            <div className="flex flex-wrap gap-0.5 px-1 py-1">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => pickEmoji(e)}
                  aria-label={`表情 ${e}`}
                  className={cn(
                    "grid size-7 place-items-center rounded-md text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    emoji === e && "bg-muted ring-1 ring-border",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
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
              onClick={hide}
            >
              <X className="size-3.5" />
              隐藏宠物（设置 → 外观 可恢复）
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 关闭角标（hover 出现） */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          hide();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="隐藏宠物"
        className="absolute -right-1 -top-1 z-10 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-soft transition-opacity hover:text-destructive group-hover/pet:opacity-100"
      >
        <X className="size-3" />
      </button>

      {/* 小宇航员本体：悬浮呼吸 */}
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        role="button"
        aria-label={agent?.name || "sag 宇航员"}
        title={agent?.name || "sag"}
        className="relative cursor-grab active:cursor-grabbing"
      >
        {/* 天线 */}
        <span className="absolute -top-2 left-1/2 h-2.5 w-px -translate-x-1/2 bg-border" />
        <span className="absolute -top-3 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary/70" />
        {/* 头盔（外壳） */}
        <div className="grid size-14 place-items-center rounded-full border-2 border-border bg-card shadow-lift ring-1 ring-foreground/5">
          {/* 面罩（内衬玻璃）+ emoji 表情 */}
          <div className="grid size-10 place-items-center overflow-hidden rounded-full bg-gradient-to-b from-muted to-background shadow-inner ring-1 ring-border">
            <span className="text-lg leading-none">{emoji}</span>
          </div>
          {/* 面罩高光 */}
          <span className="pointer-events-none absolute left-3.5 top-3 h-2 w-3 rounded-full bg-foreground/10 blur-[1px]" />
        </div>
        {/* 胸前小灯 */}
        <span className="absolute -bottom-0.5 left-1/2 size-1.5 -translate-x-1/2 animate-blink rounded-full bg-primary/60" />
      </motion.div>
    </div>
  );
}

/** 宠物开关（localStorage sag:pet，默认开）。 */
export function usePetEnabled(): [boolean, (on: boolean) => void] {
  // 初始 false：关闭者绝不闪现；开启者迟一帧出现（SSR 安全）
  const [on, setOn] = React.useState(false);
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
