"use client";

import { LogOut } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { ArchivedThreadsCard } from "@/components/features/archived-threads-card";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function AccountSettings() {
  const { user, logout } = useApp();
  const initial =
    user?.name.trim().slice(0, 1).toUpperCase() ||
    user?.email.trim().slice(0, 1).toUpperCase() ||
    "?";

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="本地身份" description="宇航员在知识航行中使用的称呼。">
        <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="text-sm">{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {user?.name || "未设置名称"}
              </div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {user?.email || "未设置邮箱"}
              </div>
            </div>
          </div>
          <Badge variant="success" className="shrink-0">
            本机
          </Badge>
        </div>
        <SettingsRow
          title="退出当前身份"
          description="返回启动页，可重新确认或更换本地身份。"
          layout="inline"
        >
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut />
            退出到启动页
          </Button>
        </SettingsRow>
      </SettingsSection>

      <ArchivedThreadsCard />
    </div>
  );
}
