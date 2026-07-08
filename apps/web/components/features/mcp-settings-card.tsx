"use client";

import * as React from "react";
import Link from "next/link";
import { Plug, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Binding } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** MCP —— 默认助手挂载的外部 MCP server（扩展工具）。 */
export function McpSettingsCard() {
  const { agent } = useApp();
  const [bindings, setBindings] = React.useState<Binding[]>([]);
  const [mode, setMode] = React.useState<"http" | "stdio">("http");
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [command, setCommand] = React.useState("");
  const [args, setArgs] = React.useState("");

  const load = React.useCallback(async () => {
    if (!agent) return;
    try {
      const all = await api.listBindings(agent.id);
      setBindings(all.filter((b) => b.target_type === "mcp_server"));
    } catch {
      /* ignore */
    }
  }, [agent]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!agent) return null;

  function label(b: Binding): string {
    const cfg = (b.config ?? {}) as { name?: string; url?: string; command?: string };
    return cfg.name || cfg.url || cfg.command || b.target_id || "MCP";
  }

  async function mount() {
    if (!agent) return;
    const config: Record<string, unknown> = name.trim() ? { name: name.trim() } : {};
    if (mode === "http") {
      if (!url.trim()) return;
      config.url = url.trim();
    } else {
      if (!command.trim()) return;
      config.command = command.trim();
      const list = args.trim().split(/\s+/).filter(Boolean);
      if (list.length) config.args = list;
    }
    try {
      await api.addBinding(agent.id, { target_type: "mcp_server", config });
      setName("");
      setUrl("");
      setCommand("");
      setArgs("");
      await load();
      toast.success("已挂载 MCP server（对话中即可调用）");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "挂载失败");
    }
  }

  async function unmount(b: Binding) {
    if (!agent) return;
    try {
      await api.removeBinding(agent.id, b.id);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "卸载失败");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP 挂载</CardTitle>
          <CardDescription>
            给助手挂载外部 MCP server（本地 filesystem、检索、自建工具…），对话中与内置检索一视同仁。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {bindings.length === 0 && (
              <span className="text-sm text-muted-foreground">尚未挂载任何 MCP server</span>
            )}
            {bindings.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs"
              >
                <Plug className="size-3.5" />
                {label(b)}
                <button onClick={() => unmount(b)} className="hover:text-destructive" aria-label="卸载">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-3">
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
              <Field className="min-w-40 flex-1">
                <FieldLabel htmlFor="mcp-name" className="sr-only">
                  名称
                </FieldLabel>
                <Input
                  id="mcp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="名称（可选，如 filesystem）"
                  className="h-8"
                />
              </Field>
            </div>
            {mode === "http" ? (
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://host/mcp  （Streamable-HTTP 端点）"
                className="h-8"
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="命令，如 npx"
                  className="h-8 w-32"
                />
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="参数，空格分隔，如 -y @modelcontextprotocol/server-filesystem /data"
                  className="h-8 flex-1"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={mount}
                disabled={mode === "http" ? !url.trim() : !command.trim()}
              >
                <Plug />
                挂载
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            反过来，每个信源也都是一个 MCP 端点，可挂进 Claude Desktop / Cursor——连接信息见
            <Link href="/knowledge" className="mx-0.5 font-medium underline underline-offset-2">
              知识库
            </Link>
            各信源详情底部。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
