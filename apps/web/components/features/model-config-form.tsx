"use client";

import * as React from "react";
import { Check, Plug, Save, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { ModelConfig, ModelConfigPatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
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

const STRATEGY_LABELS: Record<string, string> = {
  multi: "multi · 图谱增强（推荐）",
  vector: "vector · 纯向量",
  atomic: "atomic · 原子检索",
};

export function ModelConfigForm() {
  const { refreshCapabilities } = useApp();
  const [cfg, setCfg] = React.useState<ModelConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  // 表单字段
  const [llmBaseUrl, setLlmBaseUrl] = React.useState("");
  const [llmKey, setLlmKey] = React.useState("");
  const [llmModel, setLlmModel] = React.useState("");
  const [temperature, setTemperature] = React.useState(0.3);
  const [maxTokens, setMaxTokens] = React.useState(2048);
  const [ctxWindow, setCtxWindow] = React.useState(128000);
  const [embModel, setEmbModel] = React.useState("");
  const [embBaseUrl, setEmbBaseUrl] = React.useState("");
  const [embKey, setEmbKey] = React.useState("");
  const [embDims, setEmbDims] = React.useState("");
  const [strategy, setStrategy] = React.useState<ModelConfig["search_strategy"]>("multi");
  const [topK, setTopK] = React.useState(8);
  const [language, setLanguage] = React.useState<ModelConfig["sag_language"]>("zh");

  const hydrate = React.useCallback((c: ModelConfig) => {
    setCfg(c);
    setLlmBaseUrl(c.llm_base_url ?? "");
    setLlmModel(c.llm_model);
    setTemperature(c.llm_temperature);
    setMaxTokens(c.llm_max_tokens);
    setCtxWindow(c.llm_context_window ?? 128000);
    setEmbModel(c.embedding_model);
    setEmbBaseUrl(c.embedding_base_url ?? "");
    setEmbDims(c.embedding_dimensions != null ? String(c.embedding_dimensions) : "");
    setStrategy(c.search_strategy);
    setTopK(c.search_top_k);
    setLanguage(c.sag_language);
    setLlmKey("");
    setEmbKey("");
  }, []);

  React.useEffect(() => {
    api.getModelConfig().then(hydrate).catch(() => setCfg(null));
  }, [hydrate]);

  async function save() {
    setSaving(true);
    setTestResult(null);
    try {
      const patch: ModelConfigPatch = {
        llm_base_url: llmBaseUrl.trim(),
        llm_model: llmModel.trim(),
        llm_temperature: temperature,
        llm_max_tokens: maxTokens,
        llm_context_window: ctxWindow,
        embedding_model: embModel.trim(),
        embedding_base_url: embBaseUrl.trim(),
        embedding_dimensions: embDims.trim() ? Number(embDims) : null,
        search_strategy: strategy,
        search_top_k: topK,
        sag_language: language,
      };
      // 密钥仅在用户输入时提交（留空 = 保持原值）
      if (llmKey.trim()) patch.llm_api_key = llmKey.trim();
      if (embKey.trim()) patch.embedding_api_key = embKey.trim();

      const { config } = await api.saveModelConfig(patch);
      hydrate(config);
      await refreshCapabilities();
      toast.success("配置已保存并生效");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testModelConfig());
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof ApiError ? e.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  }

  if (!cfg) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  const keyPlaceholder = (isSet: boolean) => (isSet ? "已配置 · 留空保持不变" : "sk-…");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>生成模型（LLM）</CardTitle>
          <CardDescription>OpenAI 兼容端点，用于事件抽取与答案生成。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="llm-url">Base URL</FieldLabel>
            <Input
              id="llm-url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://…/v1"
            />
            <FieldDescription>OpenAI 兼容地址，如 https://api.openai.com/v1</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="llm-key">API Key</FieldLabel>
            <Input
              id="llm-key"
              type="password"
              autoComplete="off"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder={keyPlaceholder(cfg.llm_api_key_set)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="llm-model">模型</FieldLabel>
            <Input
              id="llm-model"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="llm-ctxwin">上下文窗口</FieldLabel>
            <Input
              id="llm-ctxwin"
              type="number"
              min={1024}
              max={2000000}
              value={ctxWindow}
              onChange={(e) => setCtxWindow(Math.max(1024, Number(e.target.value) || 1024))}
            />
            <FieldDescription>模型总上下文（tokens），供输入框用量圆环计算。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="llm-maxtok">最大 tokens</FieldLabel>
            <Input
              id="llm-maxtok"
              type="number"
              min={1}
              max={32768}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>温度</FieldLabel>
            <div className="flex items-center gap-4">
              <Slider
                value={[temperature]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([v]) => setTemperature(v)}
                className="flex-1"
              />
              <span className="w-10 text-right text-sm font-medium tabular-nums">
                {temperature.toFixed(1)}
              </span>
            </div>
            <FieldDescription>越低越确定、越高越发散。事件抽取建议 ≤ 0.3。</FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>向量模型（Embedding）</CardTitle>
          <CardDescription>用于文档向量化与语义检索。Base URL / Key 留空则复用 LLM 的配置。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="emb-model">模型</FieldLabel>
            <Input
              id="emb-model"
              value={embModel}
              onChange={(e) => setEmbModel(e.target.value)}
              placeholder="bge-large-zh-v1.5"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="emb-dims">维度（可选）</FieldLabel>
            <Input
              id="emb-dims"
              type="number"
              min={1}
              max={8192}
              value={embDims}
              onChange={(e) => setEmbDims(e.target.value)}
              placeholder="默认"
            />
            <FieldDescription>留空按模型默认。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="emb-url">Base URL（可选）</FieldLabel>
            <Input
              id="emb-url"
              value={embBaseUrl}
              onChange={(e) => setEmbBaseUrl(e.target.value)}
              placeholder="复用 LLM"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="emb-key">API Key（可选）</FieldLabel>
            <Input
              id="emb-key"
              type="password"
              autoComplete="off"
              value={embKey}
              onChange={(e) => setEmbKey(e.target.value)}
              placeholder={cfg.embedding_api_key_set ? "已配置 · 留空保持不变" : "复用 LLM"}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>检索</CardTitle>
          <CardDescription>召回策略、条数与抽取语言。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="strategy">检索策略</FieldLabel>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}>
              <SelectTrigger id="strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STRATEGY_LABELS).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="language">抽取语言</FieldLabel>
            <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>{`召回条数 top_k · ${topK}`}</FieldLabel>
            <Slider
              value={[topK]}
              min={1}
              max={50}
              step={1}
              onValueChange={([v]) => setTopK(v)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save />}
          {saving ? "保存中…" : "保存并生效"}
        </Button>
        <Button variant="outline" onClick={test} disabled={testing}>
          {testing ? <Spinner /> : <Plug />}
          测试连接
        </Button>
        {testResult && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm",
              testResult.ok ? "text-emerald-600 dark:text-emerald-500" : "text-destructive",
            )}
          >
            {testResult.ok ? <Check className="size-4" /> : <X className="size-4" />}
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
