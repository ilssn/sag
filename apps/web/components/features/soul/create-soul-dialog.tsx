"use client";

import * as React from "react";
import { Plus, Sparkles } from "lucide-react";
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

export function CreateSoulDialog({
  onCreated,
  trigger,
}: {
  onCreated: (s: Soul) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [avatar, setAvatar] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [greeting, setGreeting] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const soul = await api.createSoul({
        name,
        avatar: avatar || name.slice(0, 1),
        persona: { system_prompt: systemPrompt, greeting },
      });
      toast.success("灵魂已创建");
      onCreated(soul);
      setOpen(false);
      setName("");
      setAvatar("");
      setSystemPrompt("");
      setGreeting("");
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
          <Button variant="gold">
            <Plus className="size-4" />
            创建灵魂
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建灵魂</DialogTitle>
          <DialogDescription>
            给它一个名字与人格，之后绑定上下文，它就能带着记忆与你对话。
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
                placeholder="如：阿默 / 决策脑 / 关羽"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soul-sp">人格设定（System Prompt）</Label>
            <Textarea
              id="soul-sp"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是阿默，简洁、克制、可靠。只依据绑定的上下文作答。"
              rows={3}
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

          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              <Sparkles className="size-4" />
              {loading ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
