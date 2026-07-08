"use client";

import * as React from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * 只读成员（viewer）看到的禁用写入口：保留按钮形态但不可点，
 * 悬停说明原因，避免点击后才收到 403。
 */
export function ReadOnlyButton({
  label,
  size,
  icon,
}: {
  label: string;
  size?: "sm" | "md" | "lg" | "icon";
  icon?: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span 承接 disabled 按钮的悬停事件 */}
          <span className="inline-flex cursor-not-allowed">
            <Button variant="outline" size={size} disabled className="pointer-events-none">
              {icon ?? <Lock className="size-3.5" />}
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>只读成员无法执行此操作</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
