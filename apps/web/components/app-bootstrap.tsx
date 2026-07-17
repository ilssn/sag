"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";

import { loadRuntimeConfig } from "@/lib/runtime-config";
import { DEFAULT_AGENT_AVATAR, PRODUCT_NAME } from "@/lib/branding";
import { PetHeadAvatar } from "@/components/features/pet-head-avatar";
import { SpaceBackdrop } from "@/components/features/space-backdrop";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type BootStatus =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; detail: string };

/**
 * 启动门（ADR-0007）：在任何业务 UI 挂载前完成运行时配置解析。
 * 预渲染/静态导出输出的 HTML 即 Splash——门内组件从不参与构建期求值，
 * 因此门后代码可以放心读取 runtimeConfig() 与 window。
 */
export function AppBootstrap({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<BootStatus>({ phase: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    loadRuntimeConfig()
      .then(() => {
        if (alive) setStatus({ phase: "ready" });
      })
      .catch((error: unknown) => {
        if (alive) {
          setStatus({
            phase: "error",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (status.phase === "ready") return <>{children}</>;
  if (status.phase === "error") {
    return (
      <BootError
        detail={status.detail}
        onRetry={() => {
          setStatus({ phase: "loading" });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  return <BootSplash />;
}

/** 无文字 Splash：预渲染阶段语言尚未解析，视觉与 AppShell 的 FullLoader 对齐。 */
function BootSplash() {
  return (
    <div className="bg-space-field grid h-screen place-items-center">
      <SpaceBackdrop />
      <div
        className="relative z-10 flex flex-col items-center gap-2.5"
        role="status"
        aria-busy="true"
        aria-label={PRODUCT_NAME}
      >
        <PetHeadAvatar
          face={DEFAULT_AGENT_AVATAR}
          size="lg"
          className="sag-full-loader__avatar"
        />
      </div>
    </div>
  );
}

function BootError({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  const t = useTranslations("Bootstrap");
  return (
    <div className="bg-space-field grid h-screen place-items-center px-5">
      <SpaceBackdrop />
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        <Alert variant="destructive" className="bg-background/80 backdrop-blur-md">
          <AlertTitle>{t("configErrorTitle")}</AlertTitle>
          <AlertDescription className="mt-1 flex flex-col gap-3">
            <span>{t("configErrorBody")}</span>
            <span className="break-all font-mono text-xs opacity-80">{detail}</span>
            <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
              <RotateCcw className="size-4" />
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
