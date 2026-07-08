"use client";

import * as React from "react";
import { Plug } from "lucide-react";

import { api } from "@/lib/api";
import type { SourceMcpDescriptor } from "@/lib/types";
import { CodeBlock } from "@/components/features/code-block";
import { CopyButton } from "@/components/features/copy-button";

export function SourceMcpCard({ sourceId }: { sourceId: string }) {
  const [desc, setDesc] = React.useState<SourceMcpDescriptor | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    api
      .sourceMcp(sourceId)
      .then(setDesc)
      .catch(() => setFailed(true));
  }, [sourceId]);

  if (failed || !desc) return null;

  const stdioSnippet = JSON.stringify(
    {
      mcpServers: {
        [desc.stdio.env.SAG_MCP_SOURCE_ID ? desc.source_name || "sag" : "sag"]: {
          command: desc.stdio.command,
          args: desc.stdio.args,
          env: desc.stdio.env,
        },
      },
    },
    null,
    2,
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Plug className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">作为 MCP 挂载</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        把这个信源接入 Claude Desktop / Cursor 等 MCP 宿主，直接检索它的内容。提供工具：
        {desc.tools.map((t) => (
          <code key={t} className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            {t}
          </code>
        ))}
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">HTTP（Streamable-HTTP）</span>
          <CopyButton text={desc.http.url} label="URL" />
        </div>
        <CodeBlock>{desc.http.url}</CodeBlock>
        <p className="text-[11px] text-muted-foreground">{desc.http.note}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">stdio（配置片段）</span>
          <CopyButton text={stdioSnippet} label="配置" />
        </div>
        <CodeBlock>{stdioSnippet}</CodeBlock>
        <p className="text-[11px] text-muted-foreground">{desc.stdio.note}</p>
      </div>
    </section>
  );
}
