"use client";

import * as React from "react";
import { Database, Globe2, LockKeyhole, RotateCw, Terminal } from "lucide-react";

import { CodeBlock } from "@/components/features/code-block";
import { CopyButton } from "@/components/features/copy-button";
import { McpToolList } from "@/components/features/mcp-tool-list";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { KnowledgeMcpDescriptor } from "@/lib/types";

function httpConfig(descriptor: KnowledgeMcpDescriptor, token?: string | null) {
  const headers = { ...descriptor.http.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    mcpServers: {
      "SAG Knowledge": {
        type: "http",
        url: descriptor.http.url,
        headers,
      },
    },
  };
}

function stdioConfig(descriptor: KnowledgeMcpDescriptor) {
  return {
    mcpServers: {
      "SAG Knowledge": {
        command: descriptor.stdio.command,
        args: descriptor.stdio.args,
      },
    },
  };
}

export function McpServiceSettings() {
  const [descriptor, setDescriptor] = React.useState<KnowledgeMcpDescriptor | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"http" | "stdio">("http");

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setDescriptor(await api.knowledgeMcp());
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "无法加载集成配置");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const snippets = React.useMemo(() => {
    if (!descriptor) return null;
    const previewHeaders = {
      ...descriptor.http.headers,
      Authorization: "Bearer <SAG_TOKEN>",
    };
    return {
      httpPreview: JSON.stringify(
        {
          mcpServers: {
            "SAG Knowledge": {
              type: "http",
              url: descriptor.http.url,
              headers: previewHeaders,
            },
          },
        },
        null,
        2,
      ),
      httpCopy: JSON.stringify(httpConfig(descriptor, getToken()), null, 2),
      stdio: JSON.stringify(stdioConfig(descriptor), null, 2),
    };
  }, [descriptor]);

  if (error) {
    return (
      <SettingsSection title="知识库 MCP" description="将 SAG 知识库连接到外部 AI 客户端。">
        <SettingsRow title="服务配置">
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RotateCw />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        </SettingsRow>
      </SettingsSection>
    );
  }

  if (!descriptor || !snippets) {
    return (
      <SettingsSection title="知识库 MCP" description="将 SAG 知识库连接到外部 AI 客户端。">
        <SettingsRow title="开放范围">
          <div className="flex gap-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-20" />
          </div>
        </SettingsRow>
        <SettingsRow title="连接配置">
          <div className="grid gap-3">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-52 w-full" />
          </div>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const preview = mode === "http" ? snippets.httpPreview : snippets.stdio;
  const copyValue = mode === "http" ? snippets.httpCopy : snippets.stdio;
  const note = mode === "http" ? descriptor.http.note : descriptor.stdio.note;

  return (
    <SettingsSection title="知识库 MCP" description="将整个 SAG 知识库连接到外部 AI 客户端。">
      <SettingsRow
        title="开放范围"
        description="默认覆盖全部信源；外部客户端仍可按 source_id 收窄查询范围。"
        layout="inline"
      >
        <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
          <Badge variant="secondary" className="gap-1.5">
            <Database />
            全部知识库
          </Badge>
          <Badge variant="outline">{descriptor.source_count} 个信源</Badge>
          <Badge variant="outline">{descriptor.tools.length} 个工具</Badge>
        </div>
      </SettingsRow>

      <SettingsRow title="连接配置" description="选择客户端支持的传输方式并复制完整配置。">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              onValueChange={(value) => value && setMode(value as typeof mode)}
              aria-label="知识库 MCP 连接方式"
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
            <CopyButton text={copyValue} label="MCP 配置" />
          </div>
          <CodeBlock>{preview}</CodeBlock>
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            {mode === "http" ? (
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <Terminal className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>
              {mode === "http"
                ? `复制时会带入当前访问令牌。${note}`
                : note}
            </span>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow title="可用工具" description="外部客户端可调用的只读知识库能力。">
        <McpToolList tools={descriptor.tool_details} />
      </SettingsRow>
    </SettingsSection>
  );
}
