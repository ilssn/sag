"use client";

import * as React from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function UploadZone({
  sourceId,
  onUploaded,
  maxMb = 25,
  allowedExts,
}: {
  sourceId: string;
  onUploaded: () => void;
  maxMb?: number;
  allowedExts?: string[];
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const extOf = (name: string) => {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  };
  const accept = allowedExts && allowedExts.length > 0 ? allowedExts.join(",") : undefined;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      // 客户端先行拦截：不支持的扩展名即时提示，省一次往返
      if (allowedExts && allowedExts.length > 0 && !allowedExts.includes(extOf(file.name))) {
        toast.error(`${file.name}：不支持的文件类型`);
        continue;
      }
      try {
        await api.uploadDocument(sourceId, file);
        ok += 1;
      } catch (err) {
        toast.error(`${file.name}：${err instanceof ApiError ? err.message : "上传失败"}`);
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast.success(`已上传 ${ok} 个文件，正在后台处理`);
      onUploaded();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
        drag ? "border-gold bg-gold-soft" : "border-hairline bg-surface/40 hover:border-ink-faint",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="grid size-10 place-items-center rounded-full bg-surface-2 text-gold-strong">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
      </div>
      <div className="text-sm font-medium text-ink">
        {busy ? "上传中…" : "拖拽文件到此处，或点击选择"}
      </div>
      <div className="text-xs text-ink-faint">
        支持 Markdown / 文本 / PDF 等 · 单文件 ≤ {maxMb}MB
      </div>
    </div>
  );
}
