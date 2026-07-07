"use client";

import * as React from "react";
import { Check, FileUp, Globe, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Connector, Namespace, Source } from "@/lib/types";
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

const ICONS: Record<string, LucideIcon> = { file_upload: FileUp, web: Globe };

interface Field {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export function CreateSourceDialog({
  onCreated,
  defaultNamespaceId,
}: {
  onCreated: (s: Source) => void;
  defaultNamespaceId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [namespaces, setNamespaces] = React.useState<Namespace[]>([]);
  const [namespaceId, setNamespaceId] = React.useState(defaultNamespaceId ?? "");
  const [kind, setKind] = React.useState("file_upload");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [config, setConfig] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (connectors.length === 0) api.listConnectors().then(setConnectors).catch(() => {});
    api
      .listNamespaces()
      .then((ns) => {
        setNamespaces(ns);
        setNamespaceId(
          (prev) => prev || defaultNamespaceId || ns.find((n) => n.kind === "knowledge")?.id || ns[0]?.id || "",
        );
      })
      .catch(() => {});
  }, [open, connectors.length, defaultNamespaceId]);

  const selected = connectors.find((c) => c.kind === kind);
  const fields = (selected?.config_fields ?? []) as unknown as Field[];

  function pickKind(k: string) {
    setKind(k);
    setConfig({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const src = await api.createSource({
        name,
        description,
        connector_kind: kind,
        namespace_id: namespaceId || undefined,
        config,
      });
      toast.success("知识库已创建");
      onCreated(src);
      setOpen(false);
      setName("");
      setDescription("");
      setConfig({});
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
          新建知识库
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建知识库</DialogTitle>
          <DialogDescription>
            一个知识库即一个独立的知识库。选择采集方式，之后上传或同步文档即可就其提问。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>采集方式</Label>
            <div className="grid gap-2">
              {connectors.map((c) => {
                const active = kind === c.kind;
                const Icon = ICONS[c.kind] ?? FileUp;
                return (
                  <button
                    key={c.kind}
                    type="button"
                    onClick={() => pickKind(c.kind)}
                    className={cn(
                      "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                      active ? "border-gold/50 bg-gold-soft" : "border-hairline hover:border-ink-faint",
                    )}
                  >
                    <Icon className="mt-0.5 size-4 text-gold-strong" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink">
                        {c.title}
                        {c.supports_sync && (
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
                            可同步
                          </span>
                        )}
                        {active && <Check className="size-3.5 text-gold-strong" />}
                      </div>
                      <div className="text-xs text-ink-muted">{c.description}</div>
                    </div>
                  </button>
                );
              })}
              {connectors.length === 0 && (
                <div className="rounded-md border border-hairline p-3 text-sm text-ink-faint">载入连接器…</div>
              )}
            </div>
          </div>

          {/* 连接器配置字段（由后端元数据动态渲染） */}
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`cfg-${f.key}`}>{f.label}</Label>
              {f.type === "text" ? (
                <Textarea
                  id={`cfg-${f.key}`}
                  required={f.required}
                  value={config[f.key] ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={3}
                  className="font-mono text-xs"
                />
              ) : (
                <Input
                  id={`cfg-${f.key}`}
                  type={f.type === "password" ? "password" : "text"}
                  required={f.required}
                  value={config[f.key] ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              )}
              {f.help && <p className="text-xs text-ink-faint">{f.help}</p>}
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-ns">分组</Label>
            <select
              id="s-ns"
              value={namespaceId}
              onChange={(e) => setNamespaceId(e.target.value)}
              className="h-9 w-full rounded-sm border border-hairline bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
            >
              {namespaces.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
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
              placeholder="这个知识库包含什么内容？"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="gold" disabled={loading || !name.trim()}>
              {loading ? "创建中…" : "创建知识库"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
