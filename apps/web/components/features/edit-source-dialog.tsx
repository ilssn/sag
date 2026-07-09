"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EditSourceDialog({
  source,
  onUpdated,
  buttonClassName,
  tooltipSide = "bottom",
}: {
  source: Source;
  onUpdated?: (source: Source) => void;
  buttonClassName?: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(source.name);
  const [description, setDescription] = React.useState(source.description ?? "");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(source.name);
    setDescription(source.description ?? "");
  }, [open, source]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    setLoading(true);
    try {
      const updated = await api.updateSource(source.id, {
        name: cleanName,
        description: description.trim(),
      });
      toast.success("信源已更新");
      onUpdated?.(updated);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="修改信源"
              title="修改信源"
              className={cn("text-muted-foreground hover:text-foreground", buttonClassName)}
            >
              <Pencil className="size-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>修改信源</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>修改信源</DialogTitle>
          <DialogDescription>调整这个信息源的名称和描述。</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`source-name-${source.id}`}>名称</FieldLabel>
            <Input
              id={`source-name-${source.id}`}
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：产品手册"
              maxLength={200}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`source-desc-${source.id}`}>描述（可选）</FieldLabel>
            <Textarea
              id={`source-desc-${source.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个信源包含什么内容？"
              rows={2}
            />
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "保存中…" : "保存修改"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
