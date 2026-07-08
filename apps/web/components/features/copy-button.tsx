"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** 复制按钮 —— 成功后短暂切换为对勾并 toast，统一全站复制交互。 */
export function CopyButton({ text, label = "内容" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success(`${label}已复制`);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("复制失败");
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      复制
    </Button>
  );
}
