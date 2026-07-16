// 编排正文活动 revision 的完整预览、语义差异和受控恢复工作区。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@sharebrain/ui/components/alert-dialog";
import {
  NotionSegmentedButton,
  NotionSegmentedControl,
  NotionToolbar,
} from "@sharebrain/ui/components/notion";
import type { HocuspocusProviderWrapper } from "@platejs/yjs";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
import type { Value } from "platejs";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useDocumentActivityDetail } from "./document-activity-history.queries";
import { restoreDocumentHistorySource } from "./document-version-history.restore";

const DocumentVersionHistoryContent = lazy(() =>
  import("./document-version-history-content").then((module) => ({
    default: module.DocumentVersionHistoryContent,
  })),
);

function DocumentVersionHistoryContentFallback() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-[820px] gap-4 px-6 py-10 sm:px-12 lg:px-20"
    >
      <div className="h-7 w-2/5 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
      <div className="h-32 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

type DocumentActivityRevisionProps = {
  documentId: string;
  activityId: string;
  canRestore: boolean;
  getCollabProvider: () => HocuspocusProviderWrapper | null;
  getLiveBaseStateVector: () => string;
  onBack: () => void;
  onClose: () => void;
};

const emptyValue: Value = [];

export function DocumentActivityRevision({
  documentId,
  activityId,
  canRestore,
  getCollabProvider,
  getLiveBaseStateVector,
  onBack,
  onClose,
}: DocumentActivityRevisionProps) {
  const rootRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const detail = useDocumentActivityDetail(documentId, activityId, true);
  const [mode, setMode] = useState<"preview" | "changes">("changes");
  const [confirmMode, setConfirmMode] = useState<"normal" | "force" | null>(null);
  const [executing, setExecuting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    root.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.getAttribute("aria-busy") !== "true") {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onBack]);

  const performRestore = async (force: boolean) => {
    const provider = getCollabProvider();
    if (!provider) {
      setRestoreError(m.document_version_collab_unavailable());
      return;
    }
    setExecuting(true);
    setRestoreError(null);
    try {
      const operation = await restoreDocumentHistorySource({
        documentId,
        source: { kind: "activity", id: activityId },
        baseStateVector: getLiveBaseStateVector(),
        provider,
        force,
      });
      if (operation.status === "conflict") {
        setConfirmMode("force");
        return;
      }
      if (operation.status !== "applied") {
        throw new Error(operation.errorCode ?? operation.status);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", documentId, "activities"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", documentId, "versions"] }),
      ]);
      toast.success(m.document_version_restore_applied());
      onClose();
    } catch {
      setRestoreError(m.document_version_restore_failed());
      toast.error(m.document_version_restore_failed());
    } finally {
      setExecuting(false);
    }
  };

  const value = (detail.data?.afterValue as Value | null) ?? emptyValue;
  const previousValue = (detail.data?.beforeValue as Value | null) ?? undefined;
  const effectiveMode = mode === "changes" && previousValue ? "changes" : "preview";
  const restoreDisabled =
    !canRestore ||
    !detail.data?.restorable ||
    detail.data.unavailableMediaCount > 0 ||
    executing;
  const timestamp = detail.data
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(detail.data.occurredAt),
      )
    : "";

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-activity-revision-title"
      aria-busy={executing}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex min-h-0 flex-col bg-background text-foreground outline-none"
    >
      <NotionToolbar className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-b border-border-subtle px-3 max-sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.document_history_back()}
            disabled={executing}
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
          <strong id="document-activity-revision-title" className="truncate text-[13px] font-medium">
            {m.document_activity_revision_title()}
          </strong>
          {detail.data ? (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              · {detail.data.actor.displayName} · {timestamp}
            </span>
          ) : null}
          {detail.data?.status === "open" ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {m.document_activity_editing()}
            </span>
          ) : null}
        </div>
        <NotionSegmentedControl className="max-sm:hidden">
          <NotionSegmentedButton active={effectiveMode === "preview"} onClick={() => setMode("preview")}>
            {m.document_version_preview()}
          </NotionSegmentedButton>
          <NotionSegmentedButton
            active={effectiveMode === "changes"}
            disabled={!previousValue}
            onClick={() => setMode("changes")}
          >
            {m.document_version_changes()}
          </NotionSegmentedButton>
        </NotionSegmentedControl>
        <div className="flex items-center justify-self-end gap-1">
          {canRestore && detail.data?.restorable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={restoreDisabled}
              onClick={() => setConfirmMode("normal")}
            >
              <RotateCcw size={14} />
              <span className="max-sm:hidden">{m.document_version_restore()}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.common_close()}
            disabled={executing}
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </div>
      </NotionToolbar>

      <div className="border-b border-border-subtle p-2 sm:hidden">
        <NotionSegmentedControl>
          <NotionSegmentedButton active={effectiveMode === "preview"} onClick={() => setMode("preview")}>
            {m.document_version_preview()}
          </NotionSegmentedButton>
          <NotionSegmentedButton
            active={effectiveMode === "changes"}
            disabled={!previousValue}
            onClick={() => setMode("changes")}
          >
            {m.document_version_changes()}
          </NotionSegmentedButton>
        </NotionSegmentedControl>
      </div>
      {detail.data && detail.data.unavailableMediaCount > 0 ? (
        <div className="border-b border-border-subtle bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
          {m.document_activity_media_unavailable({
            count: String(detail.data.unavailableMediaCount),
          })}
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<DocumentVersionHistoryContentFallback />}>
          <DocumentVersionHistoryContent
            value={value}
            {...(previousValue ? { previousValue } : {})}
            mode={effectiveMode}
            comparisonLabel={m.document_activity_compare_session()}
            loading={detail.isLoading}
            error={detail.isError || Boolean(detail.data && !detail.data.inspectable)}
            onRetry={() => void detail.refetch()}
          />
        </Suspense>
      </main>
      {restoreError ? (
        <div className="absolute right-4 bottom-4 max-w-sm rounded-md border border-destructive/20 bg-background px-3 py-2 text-sm text-destructive shadow-sm">
          {restoreError}
        </div>
      ) : null}
      <AlertDialog open={confirmMode !== null} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmMode === "force"
                ? m.document_version_force_restore_title()
                : m.document_version_restore_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "force"
                ? m.document_version_force_restore_description()
                : m.document_activity_restore_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.document_version_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmMode === "force" ? "destructive" : "default"}
              onClick={() => void performRestore(confirmMode === "force")}
            >
              {confirmMode === "force"
                ? m.document_version_force_restore()
                : m.document_version_restore()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
