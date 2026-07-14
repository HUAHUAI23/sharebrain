// 渲染当前正文与 sealed checkpoints 的紧凑 Notion 时间列表。
import type { DocumentVersionSummary } from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import {
  NotionList,
  NotionListRow,
  NotionSectionHeading,
  NotionText,
} from "@sharebrain/ui/components/notion";
import { Skeleton } from "@sharebrain/ui/components/skeleton";

import { CURRENT_DOCUMENT_VERSION_KEY } from "./document-version-history.state";
import { DocumentHistoryActorAvatar } from "./document-history-avatar";

type DocumentVersionHistoryListProps = {
  items: DocumentVersionSummary[];
  selectedKey: string;
  currentActor: DocumentVersionSummary["lastEditor"];
  memberAvatarUrls: Readonly<Record<string, string>>;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (key: string) => void;
};

function groupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startValue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startValue.getTime()) / 86_400_000);
  if (days === 0) return m.document_version_today();
  if (days === 1) return m.document_version_yesterday();
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function DocumentVersionHistoryList({
  items,
  selectedKey,
  currentActor,
  memberAvatarUrls,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
}: DocumentVersionHistoryListProps) {
  const grouped = new Map<string, DocumentVersionSummary[]>();
  for (const item of items) {
    const label = groupLabel(item.sealedAt);
    grouped.set(label, [...(grouped.get(label) ?? []), item]);
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--sidebar)]">
      <div className="border-b border-border-subtle px-3 py-3">
        <NotionListRow asChild active={selectedKey === CURRENT_DOCUMENT_VERSION_KEY}>
          <button
            type="button"
            aria-current={selectedKey === CURRENT_DOCUMENT_VERSION_KEY ? "true" : undefined}
            className="grid min-h-11 w-full grid-cols-[24px_minmax(0,1fr)] gap-2 px-2 py-1.5"
            onClick={() => onSelect(CURRENT_DOCUMENT_VERSION_KEY)}
          >
            <DocumentHistoryActorAvatar
              actor={currentActor}
              memberAvatarUrl={memberAvatarUrls[currentActor.id]}
            />
            <NotionText
              title={m.document_version_current()}
              description={`${m.document_version_last_editor()}: ${currentActor.displayName}`}
            />
          </button>
        </NotionListRow>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="grid gap-2" aria-label={m.document_version_loading()}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {[...grouped.entries()].map(([label, versions]) => (
              <section key={label} className="grid gap-1">
                <NotionSectionHeading className="text-xs">{label}</NotionSectionHeading>
                <NotionList>
                  {versions.map((version) => (
                    <NotionListRow asChild active={selectedKey === version.id} key={version.id}>
                      <button
                        type="button"
                        aria-current={selectedKey === version.id ? "true" : undefined}
                        className="grid min-h-11 w-full grid-cols-[24px_minmax(0,1fr)] gap-2 px-2 py-1.5"
                        onClick={() => onSelect(version.id)}
                      >
                        <DocumentHistoryActorAvatar
                          actor={version.lastEditor}
                          memberAvatarUrl={memberAvatarUrls[version.lastEditor.id]}
                        />
                        <NotionText
                          title={timeLabel(version.sealedAt)}
                          description={`${version.lastEditor.displayName}${
                            version.kind === "restore" ? ` · ${m.document_version_restored()}` : ""
                          }${version.changeSummary ? ` · ${version.changeSummary}` : ""}`}
                        />
                      </button>
                    </NotionListRow>
                  ))}
                </NotionList>
              </section>
            ))}
            {hasMore ? (
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? m.document_version_loading() : m.document_version_load_more()}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
