"use client";

import * as React from "react";
import { FolderPlus, Plus } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Namespace } from "@/lib/types";
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

export function CreateNamespaceDialog({ onCreated }: { onCreated: (ns: Namespace) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const ns = await api.createNamespace({ name: name.trim() });
      toast.success(`命名空间「${ns.name}」已创建`);
      onCreated(ns);
      setOpen(false);
      setName("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded-full border border-dashed border-hairline px-3 py-1 text-xs text-ink-faint transition-colors hover:border-ink-faint hover:text-ink-muted">
          <Plus className="size-3.5" />
          命名空间
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建命名空间</DialogTitle>
          <DialogDescription>
            命名空间是信源的文件夹，用于按主题组织上下文，也可整组绑定给灵魂。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ns-name">名称</Label>
            <Input
              id="ns-name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：合同 / 会议 / 客户 A"
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              <FolderPlus className="size-4" />
              {loading ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
