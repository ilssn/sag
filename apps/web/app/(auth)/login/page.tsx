"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = isRegister
        ? await api.register({ email, password, name })
        : await api.login({ email, password });
      setToken(res.access_token);
      toast.success(isRegister ? "账号已创建，欢迎使用 sag" : "欢迎回来");
      router.replace("/overview");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "请求失败，请稍后再试";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[380px] animate-fade-in">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-[11px] bg-gradient-to-br from-primary to-primary/85 text-xl font-bold text-primary-foreground shadow-soft ring-1 ring-foreground/10">
          s
        </span>
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight">sag</h1>
          <p className="mt-1 text-sm text-muted-foreground">从信息源到知识问答</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-soft">
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="mb-5">
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">
              登录
            </TabsTrigger>
            <TabsTrigger value="register" className="flex-1">
              注册
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {isRegister && (
            <Field>
              <FieldLabel htmlFor="name">名称</FieldLabel>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的名字"
                autoComplete="name"
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="email">邮箱</FieldLabel>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">密码</FieldLabel>
            <Input
              id="password"
              type="password"
              required
              minLength={isRegister ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegister ? "至少 8 位" : "••••••••"}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </Field>

          <Button type="submit" size="lg" disabled={loading} className="mt-1">
            {loading && <Spinner />}
            {loading ? "请稍候…" : isRegister ? "创建账号" : "登录"}
          </Button>
        </form>
      </div>

      {isRegister && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          注册的第一个账号将成为管理员。
        </p>
      )}
    </div>
  );
}
