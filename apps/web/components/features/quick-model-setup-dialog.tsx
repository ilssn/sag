"use client";

import * as React from "react";
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Capabilities } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface QuickModelSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured: (capabilities: Capabilities) => void;
}

const PRESET_ROWS = [
  { icon: Cpu, label: "生成模型", value: "qwen3.6-flash" },
  { icon: Sparkles, label: "向量模型", value: "Qwen3-Embedding-4B · 1024 维" },
  { icon: FileText, label: "文档解析", value: "MinerU 2.5" },
  { icon: Search, label: "检索模式", value: "快速模式 · 纯向量" },
];

export function QuickModelSetupDialog({
  open,
  onOpenChange,
  onConfigured,
}: QuickModelSetupDialogProps) {
  const [apiKey, setApiKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setError("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!saving) onOpenChange(next);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError("请输入 302.AI API Key");
      inputRef.current?.focus();
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await api.quickSetup302(key);
      setApiKey("");
      setShowKey(false);
      onConfigured(result.capabilities);
      toast.success("302.AI 已配置，可以开始使用了");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "配置失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] max-w-[440px] gap-0 overflow-y-auto p-0"
        onEscapeKeyDown={(event) => saving && event.preventDefault()}
        onInteractOutside={(event) => saving && event.preventDefault()}
      >
        <form onSubmit={submit}>
          <DialogHeader className="px-6 pb-5 pt-6 pr-12">
            <div className="mb-2 grid size-10 place-items-center rounded-lg border bg-muted/50 text-foreground">
              <KeyRound className="size-5" />
            </div>
            <DialogTitle>快速配置 302.AI</DialogTitle>
            <DialogDescription className="max-w-[34rem] leading-6">
              填写一个 API Key，即可完成生成模型、向量模型、MinerU 文档解析和检索配置。
            </DialogDescription>
          </DialogHeader>

          <div className="border-y bg-muted/25 px-6">
            {PRESET_ROWS.map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className="grid min-h-12 grid-cols-[20px_88px_minmax(0,1fr)] items-center gap-2 border-b py-2.5 last:border-b-0"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="min-w-0 text-right text-sm font-medium text-foreground">
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-4 px-6 py-5">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="quick-setup-api-key">302.AI API Key</FieldLabel>
              <div className="relative">
                <Input
                  ref={inputRef}
                  id="quick-setup-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saving}
                  aria-describedby="quick-setup-key-help"
                  aria-invalid={Boolean(error)}
                  className="h-10 pr-10 font-mono"
                />
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setShowKey((value) => !value)}
                        disabled={saving}
                        aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                        className="absolute right-1 top-1 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                      >
                        {showKey ? <EyeOff /> : <Eye />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{showKey ? "隐藏 Key" : "显示 Key"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <FieldDescription id="quick-setup-key-help">
                Key 仅保存到当前部署的本地配置，读取时不会回显。
              </FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>

            <Alert className="border-border/80 bg-background py-2.5">
              <Check className="size-4" />
              <AlertDescription className="text-muted-foreground">
                默认启用 MinerU 2.5（按页计费）、128K 上下文、1024 维向量和纯向量快速检索。
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              稍后配置
            </Button>
            <Button type="submit" disabled={saving || !apiKey.trim()} className="min-w-28">
              {saving ? <Spinner aria-label="正在配置" /> : <Sparkles />}
              {saving ? "配置中…" : "快速启用"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
