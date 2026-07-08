"use client";

import * as React from "react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Agent } from "@/lib/types";
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

export function PersonaDialog({
  agent,
  trigger,
  onSaved,
}: {
  agent: Agent;
  trigger: React.ReactNode;
  onSaved: (a: Agent) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(agent.name);
  const [avatar, setAvatar] = React.useState(agent.avatar);
  const [systemPrompt, setSystemPrompt] = React.useState(agent.persona?.system_prompt ?? "");
  const [greeting, setGreeting] = React.useState(agent.persona?.greeting ?? "");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setAvatar(agent.avatar);
    setSystemPrompt(agent.persona?.system_prompt ?? "");
    setGreeting(agent.persona?.greeting ?? "");
  }, [open, agent]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const updated = await api.updateAgent(agent.id, {
        name,
        avatar,
        persona: {
          ...agent.persona,
          system_prompt: systemPrompt,
          greeting,
        },
      });
      toast.success("已保存");
      onSaved(updated);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设定</DialogTitle>
          <DialogDescription>这个助手的名字、角色与开场白。</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-avatar">头像</Label>
              <Input id="p-avatar" value={avatar} onChange={(e) => setAvatar(e.target.value.slice(0, 2))} className="w-16 text-center" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="p-name">名字</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-sp">角色说明</Label>
            <Textarea
              id="p-sp"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="你是谁、以什么口吻作答、遵守哪些边界。例如：只依据绑定的信源作答。"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-greet">开场白</Label>
            <Input id="p-greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
