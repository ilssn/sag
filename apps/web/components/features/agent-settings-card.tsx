"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { MAX_AVATAR_CHARS, normalizeAvatar } from "@/lib/avatar";
import { useApp } from "@/components/features/app-shell";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Button } from "@/components/ui/button";
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
        avatar: normalizeAvatar(avatar) || normalizeAvatar(name).slice(0, 1) || "s",
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
    <form onSubmit={save}>
      <SettingsSection
        title="默认助手"
        description="设置它在新对话中的身份、开场白和回答边界。"
        footer={
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : <Save />}
              {saving ? "保存中…" : "保存更改"}
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="基本信息"
          description={`头像最多 ${MAX_AVATAR_CHARS} 个字符；名称会显示在对话和侧栏中。`}
        >
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field className="min-w-0">
              <FieldLabel htmlFor="a-avatar">头像字符</FieldLabel>
              <div className="flex items-center gap-2">
                <div
                  className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted text-sm font-medium"
                  aria-hidden="true"
                >
                  {avatar || normalizeAvatar(name).slice(0, 1) || "s"}
                </div>
                <Input
                  id="a-avatar"
                  value={avatar}
                  onChange={(e) => setAvatar(normalizeAvatar(e.target.value))}
                  className="min-w-0 text-center font-mono"
                  placeholder="AI"
                />
              </div>
              <FieldDescription>支持 @_@、AI、单字或 emoji。</FieldDescription>
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor="a-name">助手名称</FieldLabel>
              <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
        </SettingsRow>
        <SettingsRow title="开场白" description="新对话开始时的第一句话。">
          <Field>
            <FieldLabel htmlFor="a-greet" className="sr-only">
              开场白
            </FieldLabel>
            <Input id="a-greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </Field>
        </SettingsRow>
        <SettingsRow title="系统提示" description="定义语气、边界和知识使用规则。">
          <Field>
            <FieldLabel htmlFor="a-sp" className="sr-only">
              系统提示
            </FieldLabel>
            <Textarea
              id="a-sp"
              rows={5}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是谁、以什么口吻作答、遵守哪些边界。例如：只依据知识库作答。"
              className="min-h-32 resize-y"
            />
            <FieldDescription>影响每次回答的行为边界；留空即默认「有据作答」。</FieldDescription>
          </Field>
        </SettingsRow>
      </SettingsSection>
    </form>
  );
}
