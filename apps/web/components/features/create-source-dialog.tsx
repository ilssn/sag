"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function CreateSourceDialog({
  onCreated,
  trigger,
}: {
  onCreated: (s: Source) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const src = await api.createSource({ name, description });
      toast.success("信源已创建，去上传文档吧");
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
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            新建信源
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建信源</DialogTitle>
          <DialogDescription>
            信源用来装内容。创建后上传文档，sag 会自动解析、分块并抽取事件。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="s-name">名称</FieldLabel>
            <Input
              id="s-name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：产品手册"
              maxLength={200}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="s-desc">描述（可选）</FieldLabel>
            <Textarea
              id="s-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个信源包含什么内容？"
              rows={2}
            />
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "创建中…" : "创建信源"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
