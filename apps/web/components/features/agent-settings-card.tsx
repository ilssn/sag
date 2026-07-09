"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** 助手设定 —— 默认 agent 的名字 / 头像 / 开场白 / 系统提示。 */
export function AgentSettingsCard() {
  const { agent } = useApp();
  const [name, setName] = React.useState("");
  const [avatar, setAvatar] = React.useState("");
  const [greeting, setGreeting] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setAvatar(agent.avatar);
    setGreeting(agent.persona?.greeting ?? "");
    setSystemPrompt(agent.persona?.system_prompt ?? "");
  }, [agent]);

  if (!agent) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setSaving(true);
    try {
      await api.updateAgent(agent.id, {
        name: name.trim() || "sag",
        avatar: avatar.trim() || (name.trim() || "s").slice(0, 1),
        persona: { ...agent.persona, greeting: greeting.trim(), system_prompt: systemPrompt },
      });
      toast.success("助手设定已保存（新对话生效）");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>助手</CardTitle>
        <CardDescription>你的默认助手：知识库即它的全部信源，回答自动带引用。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <Field className="w-20 shrink-0">
              <FieldLabel htmlFor="a-avatar">头像</FieldLabel>
              <Input
                id="a-avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value.slice(0, 2))}
                className="w-16 text-center"
              />
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="a-name">名字</FieldLabel>
              <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="a-greet">开场白</FieldLabel>
            <Input id="a-greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="a-sp">系统提示</FieldLabel>
            <Textarea
              id="a-sp"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是谁、以什么口吻作答、遵守哪些边界。例如：只依据知识库作答。"
            />
            <FieldDescription>影响每次回答的行为边界；留空即默认「有据作答」。</FieldDescription>
          </Field>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : <Save />}
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
