"use client";

import * as React from "react";
import {
  Braces,
  CheckCircle2,
  Globe2,
  Plug,
  RotateCw,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError } from "@/lib/api";
import { McpConfigError, parseMcpConfig } from "@/lib/mcp-config";
import type { ParsedMcpConfig, ParsedMcpServer } from "@/lib/mcp-config";
import type { Binding } from "@/lib/types";

function bindingLabel(binding: Binding): string {
  const config = (binding.config ?? {}) as { name?: string; url?: string; command?: string };
  return config.name || config.url || config.command || binding.target_id || "MCP";
}

function connectionIcon(mode: ParsedMcpServer["mode"]) {
  return mode === "http" ? <Globe2 className="size-3" /> : <Terminal className="size-3" />;
}

/** 默认助手挂载的外部 MCP 服务。 */
export function McpSettingsCard() {
  const { agent } = useApp();
  const [bindings, setBindings] = React.useState<Binding[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mounting, setMounting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [unmountingId, setUnmountingId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"http" | "stdio">("http");
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [command, setCommand] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [jsonText, setJsonText] = React.useState("");
  const [parsedJson, setParsedJson] = React.useState<ParsedMcpConfig | null>(null);
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!agent) return;
    setLoadError(null);
    try {
      const all = await api.listBindings(agent.id);
      setBindings(all.filter((binding) => binding.target_type === "mcp_server"));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "无法加载已挂载服务");
    }
  }, [agent]);

  React.useEffect(() => {
    setBindings(null);
    void load();
  }, [load]);

  const existingNames = React.useMemo(
    () =>
      new Set(
        (bindings ?? []).flatMap((binding) =>
          [binding.target_id, bindingLabel(binding)]
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
    [bindings],
  );

  const pendingImported = React.useMemo(
    () =>
      (parsedJson?.servers ?? []).filter(
        (server) => !existingNames.has(server.name.toLowerCase()),
      ),
    [existingNames, parsedJson],
  );

  if (!agent) return null;

  function parseJson(value: string) {
    setJsonText(value);
    if (!value.trim()) {
      setParsedJson(null);
      setJsonError(null);
      return;
    }
    try {
      setParsedJson(parseMcpConfig(value));
      setJsonError(null);
    } catch (error) {
      setParsedJson(null);
      setJsonError(
        error instanceof McpConfigError ? error.message : "无法识别这段 MCP 配置",
      );
    }
  }

  async function importServers() {
    if (!agent || !pendingImported.length) return;
    setImporting(true);
    let mounted = 0;
    const failed: string[] = [];
    for (const server of pendingImported) {
      try {
        await api.addBinding(agent.id, {
          target_type: "mcp_server",
          target_id: server.name,
          config: server.config,
        });
        mounted += 1;
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "挂载失败";
        failed.push(`${server.name}：${message}`);
      }
    }
    await load();
    setImporting(false);
    if (mounted) toast.success(`已挂载 ${mounted} 个 MCP 服务`);
    if (failed.length) toast.error(failed.slice(0, 2).join("；"));
    if (!failed.length) parseJson("");
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

    setMounting(true);
    try {
      await api.addBinding(agent.id, { target_type: "mcp_server", config });
      setName("");
      setUrl("");
      setCommand("");
      setArgs("");
      await load();
      toast.success("服务已挂载，可在对话中调用");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "挂载失败");
    } finally {
      setMounting(false);
    }
  }

  async function unmount(binding: Binding) {
    if (!agent) return;
    setUnmountingId(binding.id);
    try {
      await api.removeBinding(agent.id, binding.id);
      await load();
      toast.success("服务已卸载");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "卸载失败");
    } finally {
      setUnmountingId(null);
    }
  }

  return (
    <SettingsSection title="外部工具" description="为默认助手连接可在对话中调用的 MCP 服务。">
      <SettingsRow title="已挂载服务" description="这些服务可在对话中被助手调用。">
        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RotateCw />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : bindings === null ? (
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        ) : bindings.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未挂载外部工具服务。</p>
        ) : (
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            {bindings.map((binding) => {
              const label = bindingLabel(binding);
              const unmounting = unmountingId === binding.id;
              return (
                <Badge
                  key={binding.id}
                  variant="outline"
                  className="max-w-full gap-1.5 py-1 pl-2 pr-1"
                >
                  <Plug className="shrink-0" />
                  <span className="min-w-0 truncate">{label}</span>
                  <button
                    type="button"
                    onClick={() => void unmount(binding)}
                    disabled={unmounting}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                    aria-label={`卸载 ${label}`}
                    title="卸载"
                  >
                    {unmounting ? <Spinner className="size-3" /> : <X className="size-3" />}
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
      </SettingsRow>

      <SettingsRow title="添加服务" description="粘贴标准配置，或手动填写一个连接。">
        <div className="grid gap-5">
          <Field data-invalid={Boolean(jsonError)}>
            <FieldLabel htmlFor="mcp-json">
              <Braces className="size-4 text-muted-foreground" />
              MCP JSON
            </FieldLabel>
            <Textarea
              id="mcp-json"
              value={jsonText}
              onChange={(event) => parseJson(event.target.value)}
              placeholder={'{"mcpServers":{"example":{"url":"https://host/mcp"}}}'}
              className="min-h-28 resize-y font-mono text-xs leading-5"
              spellCheck={false}
              aria-invalid={Boolean(jsonError)}
            />
            {jsonError ? (
              <p role="alert" className="text-sm text-destructive">
                {jsonError}
              </p>
            ) : null}
          </Field>

          {parsedJson ? (
            <div className="grid gap-3 border-l-2 border-foreground/20 pl-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4" />
                  已识别 {parsedJson.servers.length} 个服务
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void importServers()}
                  disabled={importing || pendingImported.length === 0}
                >
                  {importing ? <Spinner /> : <Plug />}
                  {importing
                    ? "挂载中…"
                    : pendingImported.length
                      ? `挂载 ${pendingImported.length} 个服务`
                      : "已全部挂载"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {parsedJson.servers.map((server) => {
                  const exists = existingNames.has(server.name.toLowerCase());
                  return (
                    <Badge
                      key={server.name}
                      variant={exists ? "secondary" : "outline"}
                      className="max-w-full gap-1.5"
                    >
                      {connectionIcon(server.mode)}
                      <span className="truncate">{server.name}</span>
                      {exists ? "· 已挂载" : null}
                    </Badge>
                  );
                })}
              </div>
              {parsedJson.skipped.length ? (
                <p className="text-xs text-muted-foreground">
                  已忽略停用服务：{parsedJson.skipped.join("、")}
                </p>
              ) : null}
            </div>
          ) : null}

          <FieldSeparator>或手动填写</FieldSeparator>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mount();
            }}
            className="grid gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
              <Field>
                <FieldLabel>连接方式</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={mode}
                  onValueChange={(value) => value && setMode(value as typeof mode)}
                  aria-label="MCP 连接方式"
                  className="justify-start"
                >
                  <ToggleGroupItem value="http">
                    <Globe2 />
                    HTTP
                  </ToggleGroupItem>
                  <ToggleGroupItem value="stdio">
                    <Terminal />
                    本地命令
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-name">服务名称</FieldLabel>
                <Input
                  id="mcp-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="可选，如 filesystem"
                />
              </Field>
            </div>

            {mode === "http" ? (
              <Field>
                <FieldLabel htmlFor="mcp-url">HTTP 端点</FieldLabel>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://host/mcp"
                />
                <FieldDescription>Streamable HTTP MCP 地址。</FieldDescription>
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]">
                <Field>
                  <FieldLabel htmlFor="mcp-command">命令</FieldLabel>
                  <Input
                    id="mcp-command"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="npx"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mcp-args">参数</FieldLabel>
                  <Input
                    id="mcp-args"
                    value={args}
                    onChange={(event) => setArgs(event.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem /data"
                  />
                </Field>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={mounting || (mode === "http" ? !url.trim() : !command.trim())}
              >
                {mounting ? <Spinner /> : <Plug />}
                {mounting ? "挂载中…" : "挂载服务"}
              </Button>
            </div>
          </form>
        </div>
      </SettingsRow>

    </SettingsSection>
  );
}
