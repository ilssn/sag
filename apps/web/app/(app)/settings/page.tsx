"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useApp } from "@/components/features/app-shell";
import { ModelConfigForm } from "@/components/features/model-config-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const { user, logout } = useApp();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">账户、模型与外观。</p>
      </div>

      <Tabs defaultValue="account" className="gap-4">
        <TabsList>
          <TabsTrigger value="account">账户</TabsTrigger>
          <TabsTrigger value="model">模型</TabsTrigger>
          <TabsTrigger value="appearance">外观</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>账户</CardTitle>
              <CardDescription>你的身份与登录状态。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-0">
              <Row label="名称">{user?.name}</Row>
              <Row label="邮箱">{user?.email}</Row>
              <div className="border-t pt-4">
                <Button variant="outline" size="sm" onClick={logout}>
                  退出登录
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <ModelConfigForm />
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>外观</CardTitle>
              <CardDescription>浅色、深色或跟随系统。</CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeSegment />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
