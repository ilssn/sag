"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";

import { chatHref } from "@/lib/client-route";
import { Button } from "@/components/ui/button";

/**
 * 静态托管把未知路径重写到 404.html；没有该页面时用户会永远停在启动 Splash。
 * 旧 IA 路径（/sources/:id 等）按 ADR-0006 不设兼容层，也落到这里。
 */
export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="grid min-h-[100svh] w-full place-items-center px-5">
      <div className="flex max-w-md animate-fade-in flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-lg border bg-card shadow-soft">
          <Compass className="size-6 text-muted-foreground" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild>
          <Link href={chatHref()}>{t("backToChat")}</Link>
        </Button>
      </div>
    </main>
  );
}
