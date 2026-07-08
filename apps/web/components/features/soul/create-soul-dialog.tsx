"use client";

import * as React from "react";
import { Lock, Plus, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Soul, Source, SoulVisibility } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";
import { ReadOnlyButton } from "@/components/features/read-only-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateSoulDialog({
  onCreated,
  trigger,
}: {
  onCreated: (s: Soul) => void;
  trigger?: React.ReactNode;
}) {
  const { canWrite } = useApp();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [avatar, setAvatar] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [greeting, setGreeting] = React.useState("");
  const [sources, setSources] = React.useState<Source[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [visibility, setVisibility] = React.useState<SoulVisibility>("private");
  const [isTeam, setIsTeam] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api
      .listSources()
      .then((s) => {
        setSources(s);
        // 只有一个信源时默认勾选，顺滑走完黄金路径
        setPicked(s.length === 1 ? new Set([s[0].id]) : new Set());
      })
      .catch(() => setSources([]));
    // 仅在多人空间显示可见性开关，个人空间保持简洁
    api
      .listMembers()
      .then((m) => setIsTeam(m.length > 1))
      .catch(() => setIsTeam(false));
  }, [open]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const soul = await api.createSoul({
        name,
        avatar: avatar || name.slice(0, 1),
        persona: { system_prompt: systemPrompt, greeting },
        visibility: isTeam ? visibility : undefined,
      });
      let bound = 0;
      for (const id of picked) {
        try {
          await api.addBinding(soul.id, { target_type: "source", target_id: id });
          bound += 1;
        } catch {
          /* 单个失败不阻断创建 */
        }
      }
      toast.success(bound > 0 ? `助手已创建，绑定了 ${bound} 个信源` : "助手已创建");
      onCreated(soul);
      setOpen(false);
      setName("");
      setAvatar("");
      setSystemPrompt("");
      setGreeting("");
      setPicked(new Set());
      setVisibility("private");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  if (!canWrite) return <ReadOnlyButton label="创建助手" icon={<Plus className="size-4" />} />;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="gold">
            <Plus className="size-4" />
            创建助手
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建助手</DialogTitle>
          <DialogDescription>
            起个名字、写好设定，绑定信源后，它就能带着记忆与你对话。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soul-avatar">头像</Label>
              <Input
                id="soul-avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value.slice(0, 2))}
                placeholder={name.slice(0, 1) || "🙂"}
                className="w-16 text-center"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="soul-name">名字</Label>
              <Input
                id="soul-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：阿默 / 决策脑"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              绑定信源
              {picked.size > 0 && <span className="ml-1 text-ink-faint">（已选 {picked.size}）</span>}
            </Label>
            {sources.length === 0 ? (
              <p className="rounded-sm border border-dashed border-hairline px-3 py-2.5 text-xs text-ink-faint">
                还没有信源。也可以先创建助手，稍后在工作台里绑定。
              </p>
            ) : (
              <div className="max-h-32 overflow-y-auto rounded-sm border border-hairline">
                {sources.map((s, i) => {
                  const on = picked.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                        i > 0 && "border-t border-hairline",
                        on ? "bg-gold-soft/60" : "hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(s.id)}
                        className="size-3.5 accent-[var(--gold)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                        {s.document_count} 文档
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soul-sp">设定（可选）</Label>
            <Textarea
              id="soul-sp"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是阿默，简洁、克制、可靠。只依据绑定的信源作答。"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soul-greet">开场白（可选）</Label>
            <Input
              id="soul-greet"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="我在。今天想理清什么？"
            />
          </div>

          {isTeam && (
            <div className="flex flex-col gap-1.5">
              <Label>可见性</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      key: "private" as const,
                      icon: Lock,
                      title: "私有",
                      desc: "仅你可见与对话",
                    },
                    {
                      key: "workspace" as const,
                      icon: Users,
                      title: "团队",
                      desc: "空间成员共享，对话沉淀为团队记忆",
                    },
                  ]
                ).map((o) => {
                  const Icon = o.icon;
                  const on = visibility === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setVisibility(o.key)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors",
                        on
                          ? "border-gold/60 bg-gold-soft/60"
                          : "border-hairline hover:border-gold/30 hover:bg-surface-2",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Icon className="size-3.5" />
                        {o.title}
                      </span>
                      <span className="text-xs leading-snug text-ink-faint">{o.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              <Sparkles className="size-4" />
              {loading ? "创建中…" : "创建助手"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
