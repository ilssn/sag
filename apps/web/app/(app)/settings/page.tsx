"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";

import { useApp } from "@/components/features/app-shell";
import { PageHeader } from "@/components/features/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline py-2.5 first:border-t-0 first:pt-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const opts = [
    { key: "light", label: "浅色", icon: Sun },
    { key: "dark", label: "深色", icon: Moon },
    { key: "system", label: "跟随系统", icon: Monitor },
  ];
  const current = mounted ? theme : "system";
  return (
    <div className="inline-flex rounded-md border border-hairline bg-surface-2 p-0.5">
      {opts.map((o) => {
        const Icon = o.icon;
        const active = current === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setTheme(o.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-sm transition-colors",
              active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { user, capabilities, logout } = useApp();

  return (
    <>
      <PageHeader title="设置" description="账户、模型与外观。" />

      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 md:p-8">
        <Card>
          <CardHeader>
            <CardTitle>账户</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            <Row label="名称">{user?.name}</Row>
            <Row label="邮箱">{user?.email}</Row>
            <Row label="角色">
              <Badge variant={user?.role === "admin" ? "gold" : "outline"}>
                {user?.role === "admin" ? "管理员" : "成员"}
              </Badge>
            </Row>
            <div className="border-t border-hairline pt-3">
              <Button variant="outline" size="sm" onClick={logout}>
                退出登录
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>模型与检索</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            <Row label="LLM 状态">
              {capabilities?.llm_configured ? (
                <Badge variant="success">
                  <Check className="size-3" />
                  已配置
                </Badge>
              ) : (
                <Badge variant="danger">
                  <X className="size-3" />
                  未配置
                </Badge>
              )}
            </Row>
            <Row label="生成模型">
              <span className="font-mono text-xs">{capabilities?.llm_model}</span>
            </Row>
            <Row label="向量模型">
              <span className="font-mono text-xs">{capabilities?.embedding_model}</span>
            </Row>
            <Row label="向量后端">
              <span className="font-mono text-xs">{capabilities?.vector_provider}</span>
            </Row>
            <Row label="检索策略">
              <span className="font-mono text-xs">{capabilities?.search_strategy}</span>
            </Row>
            <Row label="抽取语言">
              <span className="font-mono text-xs">{capabilities?.language}</span>
            </Row>
          </CardContent>
        </Card>

        <div className="rounded-md border border-hairline bg-surface-2/50 p-4 text-xs leading-relaxed text-ink-muted">
          当前版本模型配置通过后端环境变量设置：
          <span className="font-mono"> MUSE_LLM_BASE_URL</span>、
          <span className="font-mono"> MUSE_LLM_API_KEY</span>、
          <span className="font-mono"> MUSE_LLM_MODEL</span>、
          <span className="font-mono"> MUSE_EMBEDDING_MODEL</span>。
          修改 <span className="font-mono">apps/api/.env</span> 后重启后端即可生效。可视化配置将在后续版本提供。
        </div>

        <Card>
          <CardHeader>
            <CardTitle>外观</CardTitle>
          </CardHeader>
          <CardContent>
            <ThemeSegment />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
