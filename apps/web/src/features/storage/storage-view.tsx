// 展示当前空间的容量摘要、占用状态与媒体分类明细。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow, NotionToolbar } from "@sharebrain/ui/components/notion";
import { Progress } from "@sharebrain/ui/components/progress";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Image as ImageIcon, PanelsTopLeft, Paperclip, UserRound } from "lucide-react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import { formatBytes } from "./format-bytes";

import type { StorageSummary } from "@sharebrain/contracts";

const categories = [
  ["avatar", m.storage_breakdown_avatar, UserRound],
  ["inline", m.storage_breakdown_inline, ImageIcon],
  ["attachment", m.storage_breakdown_attachment, Paperclip],
  ["cover", m.storage_breakdown_cover, PanelsTopLeft],
] as const;

export function StorageView() {
  const navigate = useNavigate();
  const storage = useQuery({
    queryKey: queryKeys.storageSummary,
    queryFn: () => apiRequest<StorageSummary>("/api/storage/summary"),
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <NotionToolbar className="justify-between px-3">
        <Button variant="ghost" size="icon" aria-label={m.common_back_home()} onClick={() => void navigate({ to: "/" })}>
          <ArrowLeft />
        </Button>
        <AccountMenu />
      </NotionToolbar>
      <section className="storage-content grid gap-8">
        <header className="grid gap-1.5">
          <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-normal max-[560px]:text-2xl">
            {m.storage_title()}
          </h1>
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">{m.storage_description()}</p>
        </header>
        {storage.isLoading ? <NotionEmpty>{m.storage_loading()}</NotionEmpty> : null}
        {storage.error ? <NotionEmpty>{m.storage_unavailable()}</NotionEmpty> : null}
        {storage.data ? (
          <div className="grid gap-8">
            <section className="grid gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <strong className="text-xl font-semibold tabular-nums">{formatBytes(storage.data.usedBytes)}</strong>
                <span className="text-[13px] tabular-nums text-muted-foreground">{formatBytes(storage.data.quotaBytes)}</span>
              </div>
              <Progress
                className="h-2 bg-muted/80"
                value={Math.min(
                  ((storage.data.usedBytes + storage.data.reservedBytes + storage.data.reclaimingBytes) /
                    storage.data.quotaBytes) *
                    100,
                  100,
                )}
              />
              <div className="grid grid-cols-3 divide-x divide-border-subtle border-y border-border-subtle py-3 text-sm max-[560px]:grid-cols-1 max-[560px]:divide-x-0 max-[560px]:divide-y max-[560px]:py-0">
                <Metric label={m.storage_available()} value={storage.data.availableBytes} />
                <Metric label={m.storage_reserved()} value={storage.data.reservedBytes} />
                <Metric label={m.storage_reclaiming({ size: "" }).trim()} value={storage.data.reclaimingBytes} />
              </div>
            </section>
            <NotionList className="gap-0 overflow-hidden rounded-lg border border-border-subtle bg-background divide-y divide-border-subtle">
              {categories.map(([key, label, Icon]) => (
                <NotionListRow className="min-h-12 grid-cols-[32px_minmax(0,1fr)_auto] rounded-none px-3 py-1.5" key={key}>
                  <NotionIcon className="size-8 bg-muted/60 text-muted-foreground">
                    <Icon className="size-4" />
                  </NotionIcon>
                  <span className="text-[13px] font-medium">{label()}</span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {formatBytes(storage.data.breakdown[key])}
                  </span>
                </NotionListRow>
              ))}
            </NotionList>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 px-4 first:pl-0 last:pr-0 max-[560px]:px-0 max-[560px]:py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="font-medium tabular-nums">{formatBytes(value)}</strong>
    </div>
  );
}
