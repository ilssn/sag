"use client";

import * as React from "react";
import { Lightbulb } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 只展示运行开始前冻结的输入；本轮输出与工具结果不属于系统提示词。 */
export function PromptPreview({ preview }: { preview: string }) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <button
              type="button"
              className="mt-1.5 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="查看本轮模型输入"
            >
              <Lightbulb className="size-3.5" />
            </button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>查看本轮模型输入</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>本轮模型输入</DialogTitle>
          <DialogDescription>
            这是 Agent 运行开始前冻结的输入上下文。系统指令、历史对话和当前问题保持各自角色；
            可用工具通过独立的 tools schema 提供，本轮工具结果与回答不会混入这里。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-2 py-1">系统指令</span>
          <span className="rounded bg-muted px-2 py-1">历史消息</span>
          <span className="rounded bg-muted px-2 py-1">当前问题</span>
          <span className="rounded border border-dashed px-2 py-1">工具独立传入</span>
        </div>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          {preview}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
