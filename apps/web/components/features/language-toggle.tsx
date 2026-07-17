"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChangeAppLocale } from "@/components/app-bootstrap";
import type { AppLocale } from "@/i18n/config";

export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("Language");
  const changeLocale = useChangeAppLocale();
  const nextLocale: AppLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  const targetLabel =
    nextLocale === "zh-CN" ? t("switchToChinese") : t("switchToEnglish");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={className}
            aria-label={targetLabel}
            onClick={() => changeLocale(nextLocale)}
          >
            <Languages className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{targetLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
