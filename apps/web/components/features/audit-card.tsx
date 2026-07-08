"use client";

import * as React from "react";
import { Download, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

// 动作 → 中文标签 + 语义色
const ACTIONS: Record<string, { label: string; tone: "neutral" | "gold" | "danger" }> = {
  "user.register": { label: "注册", tone: "neutral" },
  "user.login": { label: "登录", tone: "neutral" },
  "source.create": { label: "创建信源", tone: "gold" },
  "source.delete": { label: "删除信源", tone: "danger" },
  "source.sync": { label: "同步信源", tone: "neutral" },
  "document.upload": { label: "上传文档", tone: "gold" },
  "document.delete": { label: "删除文档", tone: "danger" },
  "document.reprocess": { label: "重新解析", tone: "neutral" },
  "soul.create": { label: "创建助手", tone: "gold" },
  "soul.delete": { label: "删除助手", tone: "danger" },
  "soul.visibility": { label: "变更可见性", tone: "gold" },
  "member.invite": { label: "邀请成员", tone: "gold" },
  "member.role": { label: "变更角色", tone: "gold" },
  "member.remove": { label: "移除成员", tone: "danger" },
};

const PAGE = 20;

function ActionTag({ action }: { action: string }) {
  const meta = ACTIONS[action] ?? { label: action, tone: "neutral" as const };
  const variant = meta.tone === "danger" ? "danger" : meta.tone === "gold" ? "gold" : "outline";
  return <Badge variant={variant}>{meta.label}</Badge>;
}

export function AuditCard() {
  const [items, setItems] = React.useState<AuditEntry[]>([]);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [action, setAction] = React.useState("");
  const [actor, setActor] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const load = React.useCallback(
    async (reset: boolean) => {
      setLoading(true);
      const nextOffset = reset ? 0 : offset;
      try {
        const page = await api.listAudit({
          action: action || undefined,
          actor: actor || undefined,
          limit: PAGE,
          offset: nextOffset,
        });
        setTotal(page.total);
        setOffset(nextOffset + page.items.length);
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "无法加载审计");
      } finally {
        setLoading(false);
      }
    },
    [action, actor, offset],
  );

  // 过滤条件变化时重载（防抖 actor 输入）
  React.useEffect(() => {
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actor]);

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.exportAuditCsv({ action: action || undefined, actor: actor || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "zleap-audit.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4 text-ink-muted" />
          审计日志
        </CardTitle>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || total === 0}>
          <Download className="size-3.5" />
          {exporting ? "导出中…" : "导出 CSV"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          空间内的关键操作留痕，只增不改，可按动作与操作者检索、导出留档。
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="h-9 rounded-md border border-hairline bg-surface px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">全部动作</option>
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <Input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="按操作者邮箱筛选"
            className="flex-1"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline">
          <div className="max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">操作者</th>
                  <th className="px-3 py-2 font-medium">动作</th>
                  <th className="px-3 py-2 font-medium">对象</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-ink-faint">
                      暂无记录
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr key={it.id} className="border-t border-hairline align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                        {relativeTime(it.created_at)}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{it.actor_email || "—"}</td>
                      <td className="px-3 py-2">
                        <ActionTag action={it.action} />
                      </td>
                      <td className="px-3 py-2 text-ink">
                        <span className="line-clamp-1">{it.target_label || it.target_type || "—"}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-ink-faint">
          <span>
            共 {total} 条{items.length < total ? `，已载入 ${items.length}` : ""}
          </span>
          {items.length < total && (
            <Button variant="ghost" size="sm" onClick={() => load(false)} disabled={loading}>
              {loading ? "载入中…" : "加载更多"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
