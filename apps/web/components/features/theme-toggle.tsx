"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="切换主题"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {mounted && isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{isDark ? "切到浅色" : "切到深色"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
