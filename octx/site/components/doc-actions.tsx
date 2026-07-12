"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function DocActions({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button className="copy-page-button" type="button" onClick={copy}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {copied ? "已复制" : "复制页面"}
    </button>
  );
}
