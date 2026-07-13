"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { MAX_AVATAR_CHARS, normalizeAvatar } from "@/lib/avatar";
import { DEFAULT_AGENT_AVATAR, DEFAULT_AGENT_NAME } from "@/lib/branding";
import { usePetEnabled } from "@/lib/pet-preferences";
import { useApp } from "@/components/features/app-shell";
import { PetHeadAvatar } from "@/components/features/pet-head-avatar";
import { PetAppearanceSettings } from "@/components/features/pet-appearance-settings";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** 助手设定 —— 默认 agent 的名字 / 头像 / 开场白 / 系统提示。 */
export function AgentSettingsCard() {
  const { agent, replaceAgent } = useApp();
  const [name, setName] = React.useState("");
  const [avatar, setAvatar] = React.useState("");
  const [greeting, setGreeting] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [petEnabled, setPetEnabled] = usePetEnabled();

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
      const updated = await api.updateAgent(agent.id, {
        name: name.trim() || DEFAULT_AGENT_NAME,
        avatar: normalizeAvatar(avatar) || DEFAULT_AGENT_AVATAR,
        persona: { ...agent.persona, greeting: greeting.trim(), system_prompt: systemPrompt },
      });
      replaceAgent(updated);
      toast.success("助手设定已保存");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
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
                <PetHeadAvatar
                  face={avatar || DEFAULT_AGENT_AVATAR}
                  size="md"
                />
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
        <SettingsRow
          title="显示桌面宠物"
          description="默认开启；在桌面端显示可拖动的助手入口，设置立即生效。"
          layout="inline"
          contentClassName="self-end sm:self-auto"
        >
          <Switch
            type="button"
            checked={petEnabled}
            onCheckedChange={setPetEnabled}
            aria-label="显示桌面宠物"
          />
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
      <PetAppearanceSettings agentFace={avatar || DEFAULT_AGENT_AVATAR} />
    </div>
  );
}
