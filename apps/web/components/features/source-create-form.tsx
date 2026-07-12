"use client";

import * as React from "react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function SourceCreateForm({
  onCreated,
  onCancel,
  compact = false,
}: {
  onCreated: (source: Source) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const nameId = React.useId();
  const descriptionId = React.useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const source = await api.createSource({ name: name.trim(), description: description.trim() });
      toast.success("信源已创建，去上传文档吧");
      onCreated(source);
      setName("");
      setDescription("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-4", compact && "gap-3")}
    >
      <Field>
        <FieldLabel htmlFor={nameId}>名称</FieldLabel>
        <Input
          id={nameId}
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="如：产品手册"
          maxLength={200}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={descriptionId}>描述（可选）</FieldLabel>
        <Textarea
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="这个信源包含什么内容？"
          rows={compact ? 3 : 2}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            取消
          </Button>
        )}
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? "创建中…" : "创建信源"}
        </Button>
      </div>
    </form>
  );
}
