"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Github, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function LaunchPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setLoading(true);
    try {
      const response = await api.login({ name: nextName });
      setToken(response.access_token);
      toast.success(`欢迎回来，${response.user.name}`);
      router.replace("/chat");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "登录失败，请稍后重试";
      toast.error(message);
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100svh] w-full flex-col px-5 py-5 sm:px-9 sm:py-7">
      <header className="relative z-30 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5" aria-label={PRODUCT_NAME}>
          <span className="grid size-8 place-items-center rounded-md border bg-background/70 shadow-soft backdrop-blur-md">
            <Sparkles className="size-4" />
          </span>
          <span className="font-display text-sm font-semibold">{PRODUCT_NAME}</span>
        </div>
        <a
          href="https://github.com/Zleap-AI/SAG"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background/68 px-3 text-xs font-medium text-muted-foreground shadow-soft outline-none backdrop-blur-md transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Github className="size-4" />
          <span className="hidden sm:inline">Zleap-AI/SAG</span>
          <span className="sm:hidden">GitHub</span>
        </a>
      </header>

      <section className="relative z-20 flex flex-1 items-center justify-center py-8 sm:py-10">
        <div className="w-full max-w-[352px] animate-fade-in text-center">
          <h1 className="font-display text-3xl font-semibold tracking-normal sm:text-4xl">
            探索你的知识宇宙
          </h1>

          <form
            onSubmit={onSubmit}
            className="mt-6 flex flex-col gap-4 rounded-lg border bg-background/76 p-5 text-left shadow-lift backdrop-blur-xl"
          >
            <Field>
              <FieldLabel htmlFor="name">名字</FieldLabel>
              <Input
                id="name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="怎么称呼你"
                autoComplete="name"
                autoFocus
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              disabled={loading || !name.trim()}
              className="mt-1 w-full"
            >
              {loading ? <Spinner /> : <ArrowRight className="size-4" />}
              {loading ? "正在登录" : "登录"}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
