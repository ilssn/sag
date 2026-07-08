"use client";

import * as React from "react";
import { FileText, Link2, Plug, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Binding, Source } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BindingDialog({
  agentId,
  trigger,
  onChanged,
}: {
  agentId: string;
  trigger: React.ReactNode;
  onChanged?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [bindings, setBindings] = React.useState<Binding[]>([]);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [pick, setPick] = React.useState("");

  // MCP 挂载表单
  const [mode, setMode] = React.useState<"http" | "stdio">("http");
  const [mcpName, setMcpName] = React.useState("");
  const [mcpUrl, setMcpUrl] = React.useState("");
  const [mcpCommand, setMcpCommand] = React.useState("");
  const [mcpArgs, setMcpArgs] = React.useState("");

  const load = React.useCallback(async () => {
    const [b, s] = await Promise.all([api.listBindings(agentId), api.listSources()]);
    setBindings(b);
    setSources(s);
  }, [agentId]);

  React.useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, load]);

  const sourceBindings = bindings.filter((b) => b.target_type === "source");
  const mcpBindings = bindings.filter((b) => b.target_type === "mcp_server");
  const bound = new Set(sourceBindings.map((b) => b.target_id));
  const nameOf = (b: Binding) => sources.find((s) => s.id === b.target_id)?.name ?? "信源";

  async function addSource() {
    if (!pick) return;
    try {
      await api.addBinding(agentId, { target_type: "source", target_id: pick });
      setPick("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "绑定失败");
    }
  }

  async function addMcp() {
    const name = mcpName.trim();
    const config: Record<string, unknown> = name ? { name } : {};
    if (mode === "http") {
      if (!mcpUrl.trim()) return;
      config.url = mcpUrl.trim();
    } else {
      if (!mcpCommand.trim()) return;
      config.command = mcpCommand.trim();
      const args = mcpArgs.trim().split(/\s+/).filter(Boolean);
      if (args.length) config.args = args;
    }
    try {
      await api.addBinding(agentId, { target_type: "mcp_server", config });
      setMcpName("");
      setMcpUrl("");
      setMcpCommand("");
      setMcpArgs("");
      await load();
      onChanged?.();
      toast.success("已挂载 MCP server");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "挂载失败");
    }
  }

  async function remove(b: Binding) {
    try {
      await api.removeBinding(agentId, b.id);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "解绑失败");
    }
  }

  function mcpLabel(b: Binding): string {
    const cfg = (b.config ?? {}) as { name?: string; url?: string; command?: string };
    return cfg.name || cfg.url || cfg.command || b.target_id || "MCP";
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>连接</DialogTitle>
          <DialogDescription>
            把助手接到信源（回答的依据）与外部 MCP server（扩展工具）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* 信源 */}
          <section className="flex flex-col gap-2.5">
            <Label>信源</Label>
            <div className="flex flex-wrap gap-2">
              {sourceBindings.length === 0 && (
                <span className="text-sm text-muted-foreground">尚未绑定任何信源</span>
              )}
              {sourceBindings.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs"
                >
                  <FileText className="size-3.5" />
                  {nameOf(b)}
                  <button onClick={() => remove(b)} className="hover:text-destructive" aria-label="解绑">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="选择要绑定的信源…" />
                </SelectTrigger>
                <SelectContent>
                  {sources
                    .filter((s) => !bound.has(s.id))
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={addSource} disabled={!pick}>
                <Link2 className="size-4" />
                绑定
              </Button>
            </div>
          </section>

          {/* MCP server */}
          <section className="flex flex-col gap-2.5 border-t pt-5">
            <div className="flex flex-col gap-0.5">
              <Label>MCP server</Label>
              <p className="text-xs text-muted-foreground">
                挂载外部 MCP（如本地 filesystem、检索、你自建的工具），助手对话中即可调用。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {mcpBindings.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs"
                >
                  <Plug className="size-3.5" />
                  {mcpLabel(b)}
                  <button onClick={() => remove(b)} className="hover:text-destructive" aria-label="卸载">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center gap-3">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as typeof mode)}
                  aria-label="MCP 连接方式"
                >
                  <ToggleGroupItem value="http">HTTP</ToggleGroupItem>
                  <ToggleGroupItem value="stdio">本地命令</ToggleGroupItem>
                </ToggleGroup>
                <Input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="名称（可选，如 filesystem）"
                  className="h-8 flex-1"
                />
              </div>
              {mode === "http" ? (
                <Input
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  placeholder="https://host/mcp  （Streamable-HTTP 端点）"
                  className="h-8"
                />
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={mcpCommand}
                    onChange={(e) => setMcpCommand(e.target.value)}
                    placeholder="命令，如 npx"
                    className="h-8 w-32"
                  />
                  <Input
                    value={mcpArgs}
                    onChange={(e) => setMcpArgs(e.target.value)}
                    placeholder="参数，空格分隔，如 -y @modelcontextprotocol/server-filesystem /data"
                    className="h-8 flex-1"
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addMcp}
                  disabled={mode === "http" ? !mcpUrl.trim() : !mcpCommand.trim()}
                >
                  <Plug className="size-3.5" />
                  挂载
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
