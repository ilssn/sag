"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("AgentSettings");
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
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={save}>
        <SettingsSection
          title={t("title")}
          description={t("description")}
          footer={
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : <Save />}
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          }
        >
        <SettingsRow
          title={t("basicInfo")}
          description={t("basicDescription", { max: MAX_AVATAR_CHARS })}
        >
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field className="min-w-0">
              <FieldLabel htmlFor="a-avatar">{t("avatar")}</FieldLabel>
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
              <FieldDescription>{t("avatarDescription")}</FieldDescription>
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor="a-name">{t("name")}</FieldLabel>
              <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
        </SettingsRow>
        <SettingsRow
          title={t("showPet")}
          description={t("showPetDescription")}
          layout="inline"
          contentClassName="self-end sm:self-auto"
        >
          <Switch
            type="button"
            checked={petEnabled}
            onCheckedChange={setPetEnabled}
            aria-label={t("showPet")}
          />
        </SettingsRow>
        <SettingsRow title={t("greeting")} description={t("greetingDescription")}>
          <Field>
            <FieldLabel htmlFor="a-greet" className="sr-only">
              {t("greeting")}
            </FieldLabel>
            <Input id="a-greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </Field>
        </SettingsRow>
        <SettingsRow title={t("systemPrompt")} description={t("systemPromptDescription")}>
          <Field>
            <FieldLabel htmlFor="a-sp" className="sr-only">
              {t("systemPrompt")}
            </FieldLabel>
            <Textarea
              id="a-sp"
              rows={5}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("systemPromptPlaceholder")}
              className="min-h-32 resize-y"
            />
            <FieldDescription>{t("systemPromptHelp")}</FieldDescription>
          </Field>
        </SettingsRow>
        </SettingsSection>
      </form>
      <PetAppearanceSettings agentFace={avatar || DEFAULT_AGENT_AVATAR} />
    </div>
  );
}
