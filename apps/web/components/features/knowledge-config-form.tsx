"use client";

import * as React from "react";
import { RotateCw, Save } from "lucide-react";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { SEARCH_STRATEGIES } from "@/lib/retrieval-config";
import type { ModelConfig, ModelConfigPatch } from "@/lib/types";

export function KnowledgeConfigForm() {
  const { refreshCapabilities } = useApp();
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [chunkMaxTokens, setChunkMaxTokens] = React.useState(1_000);
  const [chunkMode, setChunkMode] =
    React.useState<ModelConfig["document_chunk_mode"]>("standard");
  const [extractConcurrency, setExtractConcurrency] = React.useState(5);
  const [strategy, setStrategy] = React.useState<ModelConfig["search_strategy"]>("multi");
  const [topK, setTopK] = React.useState(8);
  const [language, setLanguage] = React.useState<ModelConfig["sag_language"]>("zh");

  const hydrate = React.useCallback((config: ModelConfig) => {
    setChunkMaxTokens(config.document_chunk_max_tokens ?? 1_000);
    setChunkMode(config.document_chunk_mode ?? "standard");
    setExtractConcurrency(config.document_extract_concurrency ?? 5);
    setStrategy(config.search_strategy);
    setTopK(config.search_top_k);
    setLanguage(config.sag_language);
    setLoaded(true);
  }, []);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      hydrate(await api.getModelConfig());
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "无法加载知识库配置");
    }
  }, [hydrate]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const patch: ModelConfigPatch = {
        document_chunk_max_tokens: chunkMaxTokens,
        document_chunk_mode: chunkMode,
        document_extract_concurrency: extractConcurrency,
        search_strategy: strategy,
        search_top_k: topK,
        sag_language: language,
      };
      const { config } = await api.saveModelConfig(patch);
      hydrate(config);
      await refreshCapabilities();
      toast.success("知识库配置已保存并生效");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <SettingsSection title="知识库配置" description="解析与检索参数。">
        <div className="p-4 sm:p-5">
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RotateCw />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </SettingsSection>
    );
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        {[
          ["解析", "正在加载切片与抽取参数。"],
          ["检索", "正在加载检索规则。"],
        ].map(([title, description]) => (
          <SettingsSection key={title} title={title} description={description}>
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </SettingsSection>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="解析" description="控制文档进入知识库后的切片与事件抽取。">
        <SettingsRow title="切片设置" description="确定原文块的大小与边界。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="kb-chunk-mode">切片模式</FieldLabel>
              <Select
                value={chunkMode}
                onValueChange={(value) =>
                  setChunkMode(value as ModelConfig["document_chunk_mode"])
                }
              >
                <SelectTrigger id="kb-chunk-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">智能切片（推荐）</SelectItem>
                  <SelectItem value="heading_strict">严格按标题</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {chunkMode === "heading_strict"
                  ? "遇到新标题即开始新块，适合章节结构清晰的文档。"
                  : "按内容结构聚合短段落，并受最大 token 数约束。"}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="kb-chunk-max-tokens">每块最大 tokens</FieldLabel>
              <Input
                id="kb-chunk-max-tokens"
                type="number"
                min={100}
                max={100000}
                step={100}
                value={chunkMaxTokens}
                onChange={(event) =>
                  setChunkMaxTokens(
                    Math.min(100000, Math.max(100, Number(event.target.value) || 100)),
                  )
                }
              />
              <FieldDescription>默认 1000；修改后需重新处理已有文档。</FieldDescription>
            </Field>
          </div>
        </SettingsRow>

        <SettingsRow title="抽取设置" description="控制单篇文档的事件与实体抽取速度。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="kb-extract-concurrency">单文档抽取并发</FieldLabel>
              <Input
                id="kb-extract-concurrency"
                type="number"
                min={1}
                max={50}
                value={extractConcurrency}
                onChange={(event) =>
                  setExtractConcurrency(
                    Math.min(50, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
              <FieldDescription>每篇文档同时抽取的分块数，默认 5。</FieldDescription>
            </Field>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="检索" description="控制知识召回方式和信息抽取语言。">
        <SettingsRow title="检索规则" description="调整策略、召回条数和语言。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="kb-search-strategy">检索策略</FieldLabel>
              <Select
                value={strategy}
                onValueChange={(value) =>
                  setStrategy(value as ModelConfig["search_strategy"])
                }
              >
                <SelectTrigger id="kb-search-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_STRATEGIES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kb-language">抽取语言</FieldLabel>
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value as ModelConfig["sag_language"])}
              >
                <SelectTrigger id="kb-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel>{`召回条数 · ${topK}`}</FieldLabel>
              <div className="flex h-9 items-center">
                <Slider
                  aria-label="召回条数"
                  value={[topK]}
                  min={1}
                  max={50}
                  step={1}
                  onValueChange={([value]) => setTopK(value)}
                />
              </div>
            </Field>
          </div>
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end border-t pt-4">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save />}
          {saving ? "保存中…" : "保存并生效"}
        </Button>
      </div>
    </div>
  );
}
