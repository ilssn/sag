"use client";

import * as React from "react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Soul } from "@/lib/types";
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
  soul,
  trigger,
  onSaved,
}: {
  soul: Soul;
  trigger: React.ReactNode;
  onSaved: (s: Soul) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(soul.name);
  const [avatar, setAvatar] = React.useState(soul.avatar);
  const [systemPrompt, setSystemPrompt] = React.useState(soul.persona?.system_prompt ?? "");
  const [greeting, setGreeting] = React.useState(soul.persona?.greeting ?? "");
  const [guardrails, setGuardrails] = React.useState((soul.persona?.guardrails ?? []).join("\n"));
  const [topK, setTopK] = React.useState(String(soul.persona?.top_k ?? ""));
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(soul.name);
    setAvatar(soul.avatar);
    setSystemPrompt(soul.persona?.system_prompt ?? "");
    setGreeting(soul.persona?.greeting ?? "");
    setGuardrails((soul.persona?.guardrails ?? []).join("\n"));
    setTopK(String(soul.persona?.top_k ?? ""));
  }, [open, soul]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const updated = await api.updateSoul(soul.id, {
        name,
        avatar,
        persona: {
          ...soul.persona,
          system_prompt: systemPrompt,
          greeting,
          guardrails: guardrails.split("\n").map((s) => s.trim()).filter(Boolean),
          top_k: topK ? Number(topK) : null,
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
          <DialogDescription>这个助手的身份、语气与边界。</DialogDescription>
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
            <Textarea id="p-sp" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-greet">开场白</Label>
            <Input id="p-greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-guard">边界 / 约束（每行一条）</Label>
            <Textarea
              id="p-guard"
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
              rows={2}
              placeholder="只依据绑定的信源作答&#10;涉密不外泄"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-topk">检索条数 top_k（可选）</Label>
            <Input id="p-topk" type="number" min={1} max={50} value={topK} onChange={(e) => setTopK(e.target.value)} className="w-24" />
          </div>
          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              {loading ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
