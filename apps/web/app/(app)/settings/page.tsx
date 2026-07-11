"use client";

import { AccountSettings } from "@/components/features/account-settings";
import { AgentSettingsCard } from "@/components/features/agent-settings-card";
import { AppearanceSettings } from "@/components/features/appearance-settings";
import { KnowledgeConfigForm } from "@/components/features/knowledge-config-form";
import { McpSettingsCard } from "@/components/features/mcp-settings-card";
import { McpServiceSettings } from "@/components/features/mcp-service-settings";
import { ModelConfigForm } from "@/components/features/model-config-form";
import { PageHeader } from "@/components/features/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_PAGE, SETTINGS_TABS } from "@/lib/settings-config";

const tabTriggerClassName =
  "h-10 flex-none gap-2 rounded-none border-b-2 border-transparent px-3 py-0 shadow-none " +
  "data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <PageHeader title={SETTINGS_PAGE.title} description={SETTINGS_PAGE.description} />

      <Tabs defaultValue="account" className="flex flex-col gap-6">
        <TabsList
          aria-label="设置分类"
          className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0"
        >
          {SETTINGS_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className={tabTriggerClassName}>
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="account" className="m-0 animate-fade-in">
          <AccountSettings />
        </TabsContent>

        <TabsContent value="agent" className="m-0 animate-fade-in">
          <div className="flex flex-col gap-6">
            <AgentSettingsCard />
            <McpSettingsCard />
          </div>
        </TabsContent>

        <TabsContent value="model" className="m-0 animate-fade-in">
          <ModelConfigForm />
        </TabsContent>

        <TabsContent value="knowledge" className="m-0 animate-fade-in">
          <KnowledgeConfigForm />
        </TabsContent>

        <TabsContent value="integrations" className="m-0 animate-fade-in">
          <McpServiceSettings />
        </TabsContent>

        <TabsContent value="appearance" className="m-0 animate-fade-in">
          <AppearanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
