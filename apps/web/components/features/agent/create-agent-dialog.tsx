"use client";

import * as React from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Agent, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function CreateAgentDialog({
  onCreated,
  trigger,
}: {
  onCreated: (a: Agent) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [avatar, setAvatar] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [greeting, setGreeting] = React.useState("");
  const [sources, setSources] = React.useState<Source[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
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
      const agent = await api.createAgent({
        name,
        avatar: avatar || name.slice(0, 1),
        persona: { system_prompt: systemPrompt, greeting },
      });
      let bound = 0;
      for (const id of picked) {
        try {
          await api.addBinding(agent.id, { target_type: "source", target_id: id });
          bound += 1;
        } catch {
          /* 单个失败不阻断创建 */
        }
      }
      toast.success(bound > 0 ? `助手已创建，绑定了 ${bound} 个信源` : "助手已创建");
      onCreated(agent);
      setOpen(false);
      setName("");
      setAvatar("");
      setSystemPrompt("");
      setGreeting("");
      setPicked(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            创建助手
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建助手</DialogTitle>
          <DialogDescription>
            起个名字、写好设定，绑定信源后，它就能带引用地依据你的内容作答。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Field>
              <FieldLabel htmlFor="agent-avatar">头像</FieldLabel>
              <Input
                id="agent-avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value.slice(0, 2))}
                placeholder={name.slice(0, 1) || "🙂"}
                className="w-16 text-center"
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="agent-name">名字</FieldLabel>
              <Input
                id="agent-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：阿默 / 决策脑"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>
              绑定信源
              {picked.size > 0 && (
                <span className="ml-1 text-muted-foreground">（已选 {picked.size}）</span>
              )}
            </FieldLabel>
            {sources.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                还没有信源。也可以先创建助手，稍后在工作台里绑定。
              </p>
            ) : (
              <div className="max-h-32 overflow-y-auto rounded-md border">
                {sources.map((s, i) => {
                  const on = picked.has(s.id);
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(s.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors outline-none focus-visible:bg-muted/50",
                        i > 0 && "border-t",
                        on ? "bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <Checkbox checked={on} className="pointer-events-none" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {s.document_count} 文档
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="agent-sp">设定（可选）</FieldLabel>
            <Textarea
              id="agent-sp"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是阿默，简洁、克制、可靠。只依据绑定的信源作答。"
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-greet">开场白（可选）</FieldLabel>
            <Input
              id="agent-greet"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="我在。今天想理清什么？"
            />
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              <Sparkles className="size-4" />
              {loading ? "创建中…" : "创建助手"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
