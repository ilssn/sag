"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useApp } from "@/components/features/app-shell";
import { ModelConfigForm } from "@/components/features/model-config-form";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-2.5 first:border-t-0 first:pt-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

const THEME_OPTIONS = [
  { key: "light", label: "浅色", icon: Sun },
  { key: "dark", label: "深色", icon: Moon },
  { key: "system", label: "跟随系统", icon: Monitor },
] as const;

function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "system") : "system";
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={current}
      onValueChange={(v) => v && setTheme(v)}
      aria-label="界面主题"
    >
      {THEME_OPTIONS.map(({ key, label, icon: Icon }) => (
        <ToggleGroupItem key={key} value={key} aria-label={label} className="gap-1.5 px-3">
          <Icon />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function SettingsPage() {
  const { user, logout } = useApp();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader title="设置" description="账户、模型与外观。" />

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
