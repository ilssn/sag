"use client";

import * as React from "react";
import { Check, Plug, RotateCw, Save, Sparkles, X } from "lucide-react";
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
import { cn } from "@/lib/utils";

function is302Api(url: string | null) {
  try {
    const host = new URL(url ?? "").hostname;
    return host === "api.302.ai" || host === "api.302ai.cn";
  } catch {
    return false;
  }
}

export function ModelConfigForm() {
  const { refreshCapabilities } = useApp();
  const [cfg, setCfg] = React.useState<ModelConfig | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const [llmBaseUrl, setLlmBaseUrl] = React.useState("");
  const [llmKey, setLlmKey] = React.useState("");
  const [llmModel, setLlmModel] = React.useState("");
  const [temperature, setTemperature] = React.useState(0.3);
  const [maxTokens, setMaxTokens] = React.useState(2048);
  const [timeoutMs, setTimeoutMs] = React.useState(60_000);
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [ctxWindow, setCtxWindow] = React.useState(128000);
  const [embModel, setEmbModel] = React.useState("");
  const [embBaseUrl, setEmbBaseUrl] = React.useState("");
  const [embKey, setEmbKey] = React.useState("");
  const [embDims, setEmbDims] = React.useState("");
  const [documentParser, setDocumentParser] =
    React.useState<ModelConfig["document_parser"]>("auto");
  const [extractConcurrency, setExtractConcurrency] = React.useState(5);
  const [mineruBaseUrl, setMineruBaseUrl] = React.useState("");
  const [mineruVersion, setMineruVersion] =
    React.useState<ModelConfig["mineru_version"]>("2.5");
  const [mineruKey, setMineruKey] = React.useState("");
  const [strategy, setStrategy] = React.useState<ModelConfig["search_strategy"]>("vector");
  const [topK, setTopK] = React.useState(8);
  const [language, setLanguage] = React.useState<ModelConfig["sag_language"]>("zh");

  const hydrate = React.useCallback((config: ModelConfig) => {
    setCfg(config);
    setLlmBaseUrl(config.llm_base_url ?? "");
    setLlmModel(config.llm_model);
    setTemperature(config.llm_temperature);
    setMaxTokens(config.llm_max_tokens);
    setTimeoutMs(config.llm_timeout_ms ?? 60_000);
    setMaxRetries(config.llm_max_retries ?? 2);
    setCtxWindow(config.llm_context_window ?? 128000);
    setEmbModel(config.embedding_model);
    setEmbBaseUrl(config.embedding_base_url ?? "");
    setEmbDims(config.embedding_dimensions != null ? String(config.embedding_dimensions) : "");
    setDocumentParser(config.document_parser);
    setExtractConcurrency(config.document_extract_concurrency ?? 5);
    setMineruBaseUrl(config.mineru_base_url ?? "");
    setMineruVersion(config.mineru_version);
    setStrategy(config.search_strategy);
    setTopK(config.search_top_k);
    setLanguage(config.sag_language);
    setLlmKey("");
    setEmbKey("");
    setMineruKey("");
  }, []);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      hydrate(await api.getModelConfig());
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "无法加载模型配置");
    }
  }, [hydrate]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setTestResult(null);
    try {
      const patch: ModelConfigPatch = {
        llm_base_url: llmBaseUrl.trim(),
        llm_model: llmModel.trim(),
        llm_temperature: temperature,
        llm_max_tokens: maxTokens,
        llm_timeout_ms: timeoutMs,
        llm_max_retries: maxRetries,
        llm_context_window: ctxWindow,
        embedding_model: embModel.trim(),
        embedding_base_url: embBaseUrl.trim(),
        embedding_dimensions: embDims.trim() ? Number(embDims) : null,
        document_parser: documentParser,
        document_extract_concurrency: extractConcurrency,
        mineru_base_url: mineruBaseUrl.trim() || null,
        mineru_version: mineruVersion,
        search_strategy: strategy,
        search_top_k: topK,
        sag_language: language,
      };
      if (llmKey.trim()) patch.llm_api_key = llmKey.trim();
      if (embKey.trim()) patch.embedding_api_key = embKey.trim();
      if (mineruKey.trim()) patch.mineru_api_key = mineruKey.trim();

      const { config } = await api.saveModelConfig(patch);
      hydrate(config);
      await refreshCapabilities();
      toast.success("配置已保存并生效");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testModelConfig());
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof ApiError ? error.message : "测试失败",
      });
    } finally {
      setTesting(false);
    }
  }

  async function setup302MinerU() {
    setSaving(true);
    try {
      const { config } = await api.setup302MinerU();
      hydrate(config);
      await refreshCapabilities();
      toast.success("已复用现有 302.AI Key 启用 MinerU 2.5");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "MinerU 配置失败");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <SettingsSection title="模型配置" description="生成、向量和检索参数。">
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

  if (!cfg) {
    return (
      <div className="flex flex-col gap-6">
        {[
          ["生成模型", "正在加载模型连接。"],
          ["向量模型", "正在加载向量化配置。"],
          ["文档解析", "正在加载文件解析配置。"],
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

  const keyPlaceholder = (isSet: boolean) => (isSet ? "已配置，留空保持不变" : "sk-…");
  const canReuse302Key =
    (cfg.llm_api_key_set && is302Api(cfg.llm_base_url)) ||
    (cfg.embedding_api_key_set && is302Api(cfg.embedding_base_url));

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="生成模型" description="用于答案生成和信息抽取的 OpenAI 兼容端点。">
        <SettingsRow title="连接信息" description="服务地址和访问密钥。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="llm-url">Base URL</FieldLabel>
              <Input
                id="llm-url"
                value={llmBaseUrl}
                onChange={(event) => setLlmBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <FieldDescription>填写 OpenAI 兼容的 API 地址。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="llm-key">API Key</FieldLabel>
              <Input
                id="llm-key"
                type="password"
                autoComplete="off"
                value={llmKey}
                onChange={(event) => setLlmKey(event.target.value)}
                placeholder={keyPlaceholder(cfg.llm_api_key_set)}
              />
            </Field>
          </div>
        </SettingsRow>

        <SettingsRow title="生成参数" description="控制模型、上下文与请求策略。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="llm-model">模型</FieldLabel>
              <Input
                id="llm-model"
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
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
                onChange={(event) =>
                  setCtxWindow(Math.max(1024, Number(event.target.value) || 1024))
                }
              />
              <FieldDescription>模型可处理的总 token 数。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="llm-maxtok">最大输出 tokens</FieldLabel>
              <Input
                id="llm-maxtok"
                type="number"
                min={1}
                max={32768}
                value={maxTokens}
                onChange={(event) =>
                  setMaxTokens(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </Field>
            <Field>
              <FieldLabel>{`温度 · ${temperature.toFixed(1)}`}</FieldLabel>
              <div className="flex h-9 items-center">
                <Slider
                  value={[temperature]}
                  min={0}
                  max={2}
                  step={0.1}
                  onValueChange={([value]) => setTemperature(value)}
                />
              </div>
              <FieldDescription>越低越稳定，越高越发散。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="llm-timeout">请求超时（毫秒）</FieldLabel>
              <Input
                id="llm-timeout"
                type="number"
                min={1000}
                max={600000}
                step={1000}
                value={timeoutMs}
                onChange={(event) =>
                  setTimeoutMs(
                    Math.min(600000, Math.max(1000, Number(event.target.value) || 1000)),
                  )
                }
              />
              <FieldDescription>单次模型请求的等待上限。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="llm-retries">重试次数</FieldLabel>
              <Input
                id="llm-retries"
                type="number"
                min={0}
                max={10}
                step={1}
                value={maxRetries}
                onChange={(event) =>
                  setMaxRetries(Math.min(10, Math.max(0, Number(event.target.value) || 0)))
                }
              />
              <FieldDescription>请求失败后自动重试的次数。</FieldDescription>
            </Field>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="向量模型" description="用于文档向量化和语义检索。">
        <SettingsRow title="模型与连接" description="端点或密钥留空时复用生成模型配置。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="emb-model">模型</FieldLabel>
              <Input
                id="emb-model"
                value={embModel}
                onChange={(event) => setEmbModel(event.target.value)}
                placeholder="bge-large-zh-v1.5"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="emb-dims">向量维度（可选）</FieldLabel>
              <Input
                id="emb-dims"
                type="number"
                min={1}
                max={8192}
                value={embDims}
                onChange={(event) => setEmbDims(event.target.value)}
                placeholder="使用模型默认值"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="emb-url">Base URL（可选）</FieldLabel>
              <Input
                id="emb-url"
                value={embBaseUrl}
                onChange={(event) => setEmbBaseUrl(event.target.value)}
                placeholder="复用生成模型"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="emb-key">API Key（可选）</FieldLabel>
              <Input
                id="emb-key"
                type="password"
                autoComplete="off"
                value={embKey}
                onChange={(event) => setEmbKey(event.target.value)}
                placeholder={
                  cfg.embedding_api_key_set ? "已配置，留空保持不变" : "复用生成模型"
                }
              />
            </Field>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="文档解析"
        description="配置 PDF 等文件的解析方式；MinerU 未配置或解析失败时自动回退 MarkItDown。"
      >
        <SettingsRow title="解析引擎" description="选择默认引擎，并配置可选的 MinerU 服务。">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="document-parser">解析方式</FieldLabel>
              <Select
                value={documentParser}
                onValueChange={(value) =>
                  setDocumentParser(value as ModelConfig["document_parser"])
                }
              >
                <SelectTrigger id="document-parser">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto（推荐）</SelectItem>
                  <SelectItem value="markitdown">MarkItDown</SelectItem>
                  <SelectItem value="mineru">MinerU</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {documentParser === "auto"
                  ? "配置 MinerU 后优先使用；服务异常或解析失败时回退 MarkItDown。"
                  : documentParser === "markitdown"
                    ? "使用内置 MarkItDown 解析文件，无需额外配置。"
                    : "PDF 优先使用 MinerU，失败时回退；其他格式仍由 MarkItDown 解析。"}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="mineru-version">MinerU 版本</FieldLabel>
              <Select
                value={mineruVersion}
                onValueChange={(value) =>
                  setMineruVersion(value as ModelConfig["mineru_version"])
                }
              >
                <SelectTrigger id="mineru-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2.5">2.5</SelectItem>
                  <SelectItem value="2.0">2.0</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="extract-concurrency">单文档抽取并发</FieldLabel>
              <Input
                id="extract-concurrency"
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
            <Field>
              <FieldLabel htmlFor="mineru-url">MinerU Base URL</FieldLabel>
              <Input
                id="mineru-url"
                value={mineruBaseUrl}
                onChange={(event) => setMineruBaseUrl(event.target.value)}
                placeholder="https://api.302.ai"
              />
              <FieldDescription>302 MinerU 按 PDF 页数计费，请以服务商价格为准。</FieldDescription>
              {canReuse302Key && !cfg.mineru_api_key_set && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving || testing}
                  onClick={() => void setup302MinerU()}
                  className="w-fit"
                >
                  <Sparkles />
                  复用现有 302 Key
                </Button>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="mineru-key">MinerU API Key</FieldLabel>
              <Input
                id="mineru-key"
                type="password"
                autoComplete="off"
                value={mineruKey}
                onChange={(event) => setMineruKey(event.target.value)}
                placeholder={keyPlaceholder(cfg.mineru_api_key_set)}
              />
              <FieldDescription>密钥不会回显，留空保持当前配置不变。</FieldDescription>
            </Field>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="检索" description="控制知识召回方式和信息抽取语言。">
        <SettingsRow
          title="检索规则"
          description="快速模式使用向量召回；精确模式增加实体关系扩展与 LLM 精排。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="strategy">默认检索模式</FieldLabel>
              <Select value={strategy} onValueChange={(value) => setStrategy(value as typeof strategy)}>
                <SelectTrigger id="strategy">
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
              <FieldLabel htmlFor="language">抽取语言</FieldLabel>
              <Select value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
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
              <FieldLabel>{`召回条数 · ${topK}`}</FieldLabel>
              <div className="flex h-9 items-center">
                <Slider
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="min-h-5 min-w-0">
          {testResult && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                testResult.ok ? "text-success" : "text-destructive",
              )}
            >
              {testResult.ok ? <Check className="size-4" /> : <X className="size-4" />}
              {testResult.message}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={test} variant="outline" disabled={testing || saving}>
            {testing ? <Spinner /> : <Plug />}
            {testing ? "测试中…" : "测试生成模型"}
          </Button>
          <Button type="button" onClick={save} disabled={saving || testing}>
            {saving ? <Spinner /> : <Save />}
            {saving ? "保存中…" : "保存并生效"}
          </Button>
        </div>
      </div>
    </div>
  );
}
