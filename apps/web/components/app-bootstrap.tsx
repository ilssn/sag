"use client";

import * as React from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";

import { loadRuntimeConfig } from "@/lib/runtime-config";
import { DEFAULT_AGENT_AVATAR, PRODUCT_NAME } from "@/lib/branding";
import { persistLocale, resolveInitialLocale } from "@/i18n/client";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/config";
import { PetHeadAvatar } from "@/components/features/pet";
import { SpaceBackdrop } from "@/components/features/space-backdrop";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type BootStatus =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; detail: string };

const LocaleControlContext = React.createContext<(next: AppLocale) => void>(() => {});

/** 语言切换入口：写 cookie + <html lang> 后整树重渲，无需服务端参与。 */
export function useChangeAppLocale() {
  return React.useContext(LocaleControlContext);
}

/**
 * 启动门（ADR-0006/0007）：在任何业务 UI 挂载前完成 ① 语言解析（同步）与
 * ② 运行时配置解析（异步）。预渲染/静态导出输出的 HTML 即 Splash——
 * 门后组件从不参与构建期求值，可以放心读取 runtimeConfig() 与 window。
 */
export function AppBootstrap({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = React.useState<AppLocale | null>(null);
  const [status, setStatus] = React.useState<BootStatus>({ phase: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    setLocale((current) => current ?? resolveInitialLocale());
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

  const changeLocale = React.useCallback((next: AppLocale) => {
    persistLocale(next);
    setLocale(next);
  }, []);

  // 预渲染与挂载前的首帧：语言未定，渲染无文字 Splash。
  if (!locale) return <BootSplash />;

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      onError={(error) => {
        if (process.env.NODE_ENV !== "production") console.error(error);
      }}
      getMessageFallback={({ namespace, key }) =>
        [namespace, key].filter(Boolean).join(".")
      }
    >
      {status.phase === "ready" ? (
        <LocaleControlContext.Provider value={changeLocale}>
          {children}
        </LocaleControlContext.Provider>
      ) : status.phase === "error" ? (
        <BootError
          detail={status.detail}
          onRetry={() => {
            setStatus({ phase: "loading" });
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <BootSplash />
      )}
    </NextIntlClientProvider>
  );
}

/** 无文字 Splash：语言尚未解析的帧也会渲染它，视觉与 AppShell 的 FullLoader 对齐。 */
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
