"use client";

import * as React from "react";
import { Check, FileUp, Plus } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Connector, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
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

export function CreateSourceDialog({ onCreated }: { onCreated: (s: Source) => void }) {
  const [open, setOpen] = React.useState(false);
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [kind, setKind] = React.useState("file_upload");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && connectors.length === 0) {
      api.listConnectors().then(setConnectors).catch(() => {});
    }
  }, [open, connectors.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const src = await api.createSource({ name, description, connector_kind: kind });
      toast.success("信源已创建");
      onCreated(src);
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="gold">
          <Plus className="size-4" />
          新建信源
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建信源</DialogTitle>
          <DialogDescription>
            一个信源即一个独立的知识库。选择采集方式，上传文档后即可就其提问。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>采集方式</Label>
            <div className="grid gap-2">
              {connectors.map((c) => {
                const active = kind === c.kind;
                const enabled = c.kind === "file_upload"; // MVP：仅文件上传
                return (
                  <button
                    key={c.kind}
                    type="button"
                    disabled={!enabled}
                    onClick={() => enabled && setKind(c.kind)}
                    className={cn(
                      "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                      active
                        ? "border-gold/50 bg-gold-soft"
                        : "border-hairline hover:border-ink-faint",
                      !enabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <FileUp className="mt-0.5 size-4 text-gold-strong" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink">
                        {c.title}
                        {active && <Check className="size-3.5 text-gold-strong" />}
                      </div>
                      <div className="text-xs text-ink-muted">{c.description}</div>
                    </div>
                  </button>
                );
              })}
              {connectors.length === 0 && (
                <div className="rounded-md border border-hairline p-3 text-sm text-ink-faint">
                  载入连接器…
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-name">名称</Label>
            <Input
              id="s-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：产品手册"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-desc">描述（可选）</Label>
            <Textarea
              id="s-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个信源包含什么内容？"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              {loading ? "创建中…" : "创建信源"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
