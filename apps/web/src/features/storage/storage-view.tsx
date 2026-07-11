import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty, NotionToolbar } from "@sharebrain/ui/components/notion";
import { Progress } from "@sharebrain/ui/components/progress";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Database } from "lucide-react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import { formatBytes } from "./format-bytes";

import type { StorageSummary } from "@sharebrain/contracts";

const categories = [
  ["avatar", m.storage_breakdown_avatar],
  ["inline", m.storage_breakdown_inline],
  ["attachment", m.storage_breakdown_attachment],
  ["cover", m.storage_breakdown_cover],
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
        <header className="grid gap-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Database />
          </div>
          <h1 className="m-0 text-2xl font-semibold tracking-normal">{m.storage_title()}</h1>
          <p className="m-0 text-sm text-muted-foreground">{m.storage_description()}</p>
        </header>
        {storage.isLoading ? <NotionEmpty>{m.storage_loading()}</NotionEmpty> : null}
        {storage.error ? <NotionEmpty>{m.storage_unavailable()}</NotionEmpty> : null}
        {storage.data ? (
          <div className="grid gap-7">
            <div className="grid gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <strong className="text-lg font-semibold">{formatBytes(storage.data.usedBytes)}</strong>
                <span className="text-sm text-muted-foreground">{formatBytes(storage.data.quotaBytes)}</span>
              </div>
              <Progress
                className="h-2 bg-muted"
                value={Math.min(
                  ((storage.data.usedBytes + storage.data.reservedBytes + storage.data.reclaimingBytes) /
                    storage.data.quotaBytes) *
                    100,
                  100,
                )}
              />
              <div className="grid grid-cols-3 gap-4 text-sm max-[560px]:grid-cols-1">
                <Metric label={m.storage_available()} value={storage.data.availableBytes} />
                <Metric label={m.storage_reserved()} value={storage.data.reservedBytes} />
                <Metric label={m.storage_reclaiming({ size: "" }).trim()} value={storage.data.reclaimingBytes} />
              </div>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {categories.map(([key, label]) => (
                <div className="flex min-h-12 items-center justify-between gap-4 py-2 text-sm" key={key}>
                  <span>{label()}</span>
                  <span className="text-muted-foreground">{formatBytes(storage.data.breakdown[key])}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 border-l border-border pl-3 first:border-l-0 first:pl-0 max-[560px]:border-l-0 max-[560px]:border-t max-[560px]:pt-3 max-[560px]:pl-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="font-medium">{formatBytes(value)}</strong>
    </div>
  );
}
