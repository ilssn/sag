"use client";

import * as React from "react";
import { Crown, Loader2, ShieldCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { Member, WorkspaceRole } from "@/lib/types";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "只读",
};
const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: "完全控制，含成员与空间管理",
  editor: "可读写信源、助手与记忆",
  viewer: "仅可检索与对话，不能改动",
};

export function MembersCard() {
  const { user, role: myRole } = useApp();
  const isOwner = myRole === "owner";

  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<Member | null>(null);

  const load = React.useCallback(async () => {
    try {
      setMembers(await api.listMembers());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "无法加载成员");
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setInviting(true);
    try {
      await api.inviteMember({ email: value, role: inviteRole });
      setEmail("");
      toast.success(`已邀请 ${value} 加入`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "邀请失败");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(m: Member, role: WorkspaceRole) {
    if (role === m.role) return;
    try {
      await api.updateMemberRole(m.user_id, role);
      toast.success(`已将 ${m.name} 设为${ROLE_LABEL[role]}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "修改失败");
    }
  }

  async function remove(m: Member) {
    try {
      await api.removeMember(m.user_id);
      toast.success(`已移除 ${m.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "移除失败");
    } finally {
      setRemoveTarget(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>成员</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          空间即团队的共享记忆体。成员在同一空间内共享信源与团队助手；
          {isOwner ? "你可以邀请他人并分配角色。" : "由所有者管理成员与角色。"}
        </p>

        {isOwner && (
          <form
            onSubmit={invite}
            className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-2/50 p-3 sm:flex-row sm:items-center"
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="已注册用户的邮箱"
              className="flex-1"
              autoComplete="off"
            />
            <div className="inline-flex rounded-md border border-hairline bg-surface p-0.5">
              {(["editor", "viewer"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setInviteRole(r)}
                  className={
                    "rounded-[7px] px-3 py-1.5 text-sm transition-colors " +
                    (inviteRole === r
                      ? "bg-gold text-[#1b1a17]"
                      : "text-ink-muted hover:text-ink")
                  }
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={inviting || !email.trim()}>
              {inviting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              邀请
            </Button>
          </form>
        )}
        {isOwner && (
          <p className="-mt-2 text-xs text-ink-faint">
            {ROLE_HINT[inviteRole]}。仅能邀请已注册 zleap 的用户。
          </p>
        )}

        <div className="flex flex-col divide-y divide-hairline">
          {members === null ? (
            <div className="py-6 text-center text-sm text-ink-faint">载入中…</div>
          ) : (
            members.map((m) => {
              const isSelf = m.user_id === user?.id;
              const lastOwner = m.role === "owner" && ownerCount <= 1;
              return (
                <div key={m.user_id} className="flex items-center gap-3 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-sm font-semibold text-ink-soft">
                    {(m.name || m.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                      {isSelf && <span className="text-xs text-ink-faint">（你）</span>}
                    </div>
                    <div className="truncate text-xs text-ink-faint">{m.email}</div>
                  </div>

                  {isOwner && !lastOwner ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-gold/50 hover:text-ink">
                          {m.role === "owner" && <Crown className="size-3 text-gold-strong" />}
                          {ROLE_LABEL[m.role]}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {(["owner", "editor", "viewer"] as const).map((r) => (
                          <DropdownMenuItem
                            key={r}
                            onClick={() => changeRole(m, r)}
                            className="flex flex-col items-start gap-0.5"
                          >
                            <span className="text-sm text-ink">{ROLE_LABEL[r]}</span>
                            <span className="text-xs text-ink-faint">{ROLE_HINT[r]}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Badge variant={m.role === "owner" ? "gold" : "outline"}>
                      {m.role === "owner" && <Crown className="size-3" />}
                      {ROLE_LABEL[m.role]}
                    </Badge>
                  )}

                  {isOwner && !isSelf && (
                    <button
                      onClick={() => setRemoveTarget(m)}
                      className="rounded-md p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      title="移除成员"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {!isOwner && (
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-2/50 px-3 py-2 text-xs text-ink-muted">
            <ShieldCheck className="size-3.5 shrink-0" />
            你在本空间的角色为「{ROLE_LABEL[myRole]}」。如需变更请联系空间所有者。
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`移除 ${removeTarget?.name}？`}
        description="对方将失去对本空间信源、助手与记忆的访问权限。其个人内容不受影响。"
        confirmLabel="移除"
        onConfirm={() => {
          if (removeTarget) return remove(removeTarget);
        }}
      />
    </Card>
  );
}
