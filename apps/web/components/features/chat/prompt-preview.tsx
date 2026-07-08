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

/** 「查看本轮 prompt」——把实际发给模型的提示词摊开，回答从何而来一目了然。 */
export function PromptPreview({ preview }: { preview: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <Lightbulb className="size-3" />
          查看本轮 prompt
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>本轮 prompt</DialogTitle>
          <DialogDescription>
            这是实际发送给模型的完整提示词（含人格、约束与检索到的资料）。透明可核查。
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          {preview}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
