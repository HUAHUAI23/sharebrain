// 统一编排文档活动与版本导航，同时保留两类历史的独立查询和展示语义。
import type {
  DocumentActivityBlockChange,
  DocumentActivityItem,
  DocumentVersionSummary,
} from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import {
  NotionSegmentedButton,
  NotionSegmentedControl,
} from "@sharebrain/ui/components/notion";
import { Skeleton } from "@sharebrain/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sharebrain/ui/components/tooltip";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  FilePlus2,
  Heading1,
  History,
  MessageSquare,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useDocumentActivityList } from "./document-activity-history.queries";
import { DocumentHistoryActorAvatar } from "./document-history-avatar";
import { DocumentVersionHistoryList } from "./document-version-history-list";
import { useDocumentVersionList } from "./document-version-history.queries";

export type DocumentHistoryTab = "activity" | "versions";

type DocumentHistoryPanelProps = {
  documentId: string;
  open: boolean;
  suspended: boolean;
  tab: DocumentHistoryTab;
  canReadActivity: boolean;
  canReadVersions: boolean;
  currentActor: DocumentVersionSummary["lastEditor"];
  memberAvatarUrls: Readonly<Record<string, string>>;
  onTabChange: (tab: DocumentHistoryTab) => void;
  onClose: () => void;
  onOpenActivityRevision: (activityId: string) => void;
  onOpenVersion: (versionKey: string) => void;
};

export function DocumentHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={m.document_history_open()}
          onClick={onClick}
        >
          <Clock3 size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{m.document_history_open()}</TooltipContent>
    </Tooltip>
  );
}

function groupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startValue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startValue.getTime()) / 86_400_000);
  if (days === 0) return m.document_activity_today();
  if (days === 1) return m.document_activity_yesterday();
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function timeRangeLabel(startedAt: string, occurredAt: string) {
  const start = timeLabel(startedAt);
  const end = timeLabel(occurredAt);
  return start === end ? end : `${start}–${end}`;
}

function actionLabel(item: DocumentActivityItem) {
  if (item.type === "content_edited" && item.status === "open") {
    return m.document_activity_editing();
  }
  const labels = {
    document_created: m.document_activity_created(),
    content_edited: m.document_activity_content_edited(),
    title_edited: m.document_activity_title_edited(),
    comment_added: m.document_activity_comment_added(),
    comment_replied: m.document_activity_comment_replied(),
    comment_edited: m.document_activity_comment_edited(),
    comment_deleted: m.document_activity_comment_deleted(),
    comment_resolved: m.document_activity_comment_resolved(),
    version_restored: m.document_activity_version_restored(),
  } satisfies Record<DocumentActivityItem["type"], string>;
  return labels[item.type];
}

function ActivityIcon({ item }: { item: DocumentActivityItem }) {
  const className = "size-3.5 text-muted-foreground";
  switch (item.type) {
    case "document_created":
      return <FilePlus2 className={className} />;
    case "title_edited":
      return <Heading1 className={className} />;
    case "comment_added":
    case "comment_replied":
    case "comment_edited":
    case "comment_deleted":
      return <MessageSquare className={className} />;
    case "comment_resolved":
      return <CheckCircle2 className={className} />;
    case "version_restored":
      return <RotateCcw className={className} />;
    default:
      return item.status === "open" ? (
        <span className="size-2 animate-pulse rounded-full bg-primary" />
      ) : (
        <Pencil className={className} />
      );
  }
}

function blockText(snapshot: DocumentActivityBlockChange["before"] | undefined) {
  return snapshot?.text || m.document_activity_empty_block();
}

function ChangeSummary({
  change,
  expanded,
}: {
  change: DocumentActivityBlockChange;
  expanded: boolean;
}) {
  const label = {
    inserted: m.document_activity_inserted(),
    updated: m.document_activity_updated(),
    deleted: m.document_activity_deleted(),
  }[change.kind];
  const labelClass = {
    inserted: "text-emerald-700",
    updated: "text-amber-700",
    deleted: "text-red-700",
  }[change.kind];
  const contentClass = expanded ? "line-clamp-3 break-words" : "truncate";

  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 text-xs leading-5">
      <span className={labelClass}>{label}</span>
      {change.kind === "updated" && expanded ? (
        <span className="grid min-w-0 gap-0.5">
          <span className={`${contentClass} text-muted-foreground line-through decoration-red-600`}>
            {blockText(change.before)}
          </span>
          <span className={`${contentClass} text-amber-900`}>{blockText(change.after)}</span>
        </span>
      ) : (
        <span
          className={`${contentClass} ${
            change.kind === "deleted"
              ? "text-muted-foreground line-through decoration-red-600"
              : change.kind === "inserted"
                ? "text-emerald-900"
                : "text-amber-900"
          }`}
        >
          {blockText(change.after ?? change.before)}
        </span>
      )}
    </div>
  );
}

function ActivityDetails({ item, expanded }: { item: DocumentActivityItem; expanded: boolean }) {
  const details = item.details;
  if (details.kind === "content") {
    const visible = expanded ? details.changes : details.changes.slice(0, 3);
    const remaining = Math.max(0, details.totalChangedBlocks - visible.length);
    return (
      <div className="mt-2 grid gap-1 border-l border-border-subtle pl-3">
        {visible.map((change) => (
          <ChangeSummary key={change.blockId} change={change} expanded={expanded} />
        ))}
        {remaining > 0 ? (
          <span className="text-muted-foreground text-xs leading-5">
            {m.document_activity_more_changes({ count: String(remaining) })}
          </span>
        ) : null}
      </div>
    );
  }
  if (details.kind === "title") {
    return (
      <p className={`${expanded ? "line-clamp-4" : "line-clamp-2"} mt-2 text-xs leading-5`}>
        <span className="text-muted-foreground line-through decoration-red-600">
          {details.beforeTitle}
        </span>
        <span className="px-1.5 text-muted-foreground" aria-hidden="true">
          →
        </span>
        <span>{details.afterTitle}</span>
      </p>
    );
  }
  if (details.kind === "comment") {
    return details.excerpt ? (
      <p className={`${expanded ? "line-clamp-4" : "line-clamp-2"} mt-2 text-muted-foreground text-xs leading-5`}>
        {details.excerpt}
      </p>
    ) : null;
  }
  if (details.kind === "restore") {
    return (
      <p className="mt-2 text-muted-foreground text-xs leading-5">
        {details.sourceKind === "activity"
          ? m.document_activity_revision_restored()
          : m.document_activity_version_number({ version: String(details.sourceVersionNo) })}
      </p>
    );
  }
  return details.title ? (
    <p className="mt-2 truncate text-muted-foreground text-xs leading-5">{details.title}</p>
  ) : null;
}

function ActivityRow({
  item,
  expanded,
  onToggle,
  onOpenRevision,
  memberAvatarUrl,
}: {
  item: DocumentActivityItem;
  expanded: boolean;
  onToggle: () => void;
  onOpenRevision: () => void;
  memberAvatarUrl?: string | undefined;
}) {
  const changedBlocks = item.details.kind === "content" ? item.details.totalChangedBlocks : null;

  return (
    <article className="relative">
      <button
        type="button"
        aria-expanded={expanded}
        className={`grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)] gap-2.5 rounded-md px-2 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring ${expanded ? "bg-muted/60" : ""}`}
        onClick={onToggle}
      >
        <DocumentHistoryActorAvatar actor={item.actor} memberAvatarUrl={memberAvatarUrl} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-1.5 pr-14 text-[13px] leading-5">
            <span className="truncate font-medium">{item.actor.displayName}</span>
            <span className="min-w-0 text-muted-foreground">{actionLabel(item)}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            <ActivityIcon item={item} />
            <time dateTime={item.occurredAt}>{timeRangeLabel(item.startedAt, item.occurredAt)}</time>
            {changedBlocks !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">
                  {m.document_activity_changed_blocks({ count: String(changedBlocks) })}
                </span>
              </>
            ) : null}
          </div>
          <ActivityDetails item={item} expanded={expanded} />
        </div>
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`pointer-events-none absolute top-3 ${item.inspectable ? "right-9" : "right-2"} text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {item.inspectable ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2 right-1 size-7 opacity-70 hover:opacity-100"
              aria-label={m.document_activity_view_revision()}
              onClick={(event) => {
                event.stopPropagation();
                onOpenRevision();
              }}
            >
              <History size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{m.document_activity_view_revision()}</TooltipContent>
        </Tooltip>
      ) : null}
    </article>
  );
}

function ActivityHistoryList({
  documentId,
  enabled,
  onOpenRevision,
  memberAvatarUrls,
}: {
  documentId: string;
  enabled: boolean;
  onOpenRevision: (activityId: string) => void;
  memberAvatarUrls: Readonly<Record<string, string>>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useDocumentActivityList(documentId, enabled);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, DocumentActivityItem[]>();
    for (const item of items) {
      const label = groupLabel(item.occurredAt);
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    }
    return grouped;
  }, [items]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
      {query.isPending ? (
        <div className="grid gap-3 py-2" aria-label={m.document_activity_loading()}>
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 py-2">
              <Skeleton className="size-6 rounded-full" />
              <div className="grid gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="grid place-items-center gap-2 py-16 text-center">
          <p className="text-muted-foreground text-sm">{m.document_activity_error()}</p>
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground text-sm">
          {m.document_activity_empty()}
        </p>
      ) : (
        <div>
          {[...groups.entries()].map(([label, groupItems]) => (
            <section key={label} className="border-b last:border-b-0">
              <h3 className="sticky top-0 z-10 bg-background/95 py-2 font-medium text-muted-foreground text-xs backdrop-blur-sm">
                {label}
              </h3>
              <div className="grid gap-0.5">
                {groupItems.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() =>
                      setExpandedId((current) => (current === item.id ? null : item.id))
                    }
                    onOpenRevision={() => onOpenRevision(item.id)}
                    memberAvatarUrl={memberAvatarUrls[item.actor.id]}
                  />
                ))}
              </div>
            </section>
          ))}
          {query.hasNextPage ? (
            <Button
              className="my-3 w-full"
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? m.document_activity_loading()
                : m.document_activity_load_more()}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function DocumentHistoryPanel({
  documentId,
  open,
  suspended,
  tab,
  canReadActivity,
  canReadVersions,
  currentActor,
  onTabChange,
  onClose,
  onOpenActivityRevision,
  onOpenVersion,
  memberAvatarUrls,
}: DocumentHistoryPanelProps) {
  const versionList = useDocumentVersionList(documentId, open && tab === "versions");
  const versionItems = useMemo(
    () => versionList.data?.pages.flatMap((page) => page.items) ?? [],
    [versionList.data],
  );

  useEffect(() => {
    if (!open || suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, suspended]);

  if (!open) return null;

  return (
    <aside
      aria-label={m.document_history_title()}
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-lg sm:w-[336px]"
    >
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b px-3">
        <h2 className="truncate px-1 font-semibold text-sm">{m.document_history_title()}</h2>
        {canReadActivity && canReadVersions ? (
          <NotionSegmentedControl>
            <NotionSegmentedButton
              active={tab === "activity"}
              onClick={() => onTabChange("activity")}
            >
              {m.document_history_activity()}
            </NotionSegmentedButton>
            <NotionSegmentedButton
              active={tab === "versions"}
              onClick={() => onTabChange("versions")}
            >
              {m.document_history_versions()}
            </NotionSegmentedButton>
          </NotionSegmentedControl>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={m.common_close()}
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </header>

      <div className={`${tab === "activity" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
        {canReadActivity ? (
          <ActivityHistoryList
            documentId={documentId}
            enabled={open && tab === "activity"}
            onOpenRevision={onOpenActivityRevision}
            memberAvatarUrls={memberAvatarUrls}
          />
        ) : null}
      </div>
      <div className={`${tab === "versions" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
        {canReadVersions ? (
          <DocumentVersionHistoryList
            items={versionItems}
            selectedKey=""
            currentActor={currentActor}
            memberAvatarUrls={memberAvatarUrls}
            loading={versionList.isLoading}
            hasMore={versionList.hasNextPage}
            loadingMore={versionList.isFetchingNextPage}
            onLoadMore={() => void versionList.fetchNextPage()}
            onSelect={onOpenVersion}
          />
        ) : null}
      </div>
    </aside>
  );
}
