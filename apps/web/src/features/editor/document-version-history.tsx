// 编排 Notion 风格正文版本历史工作区、分页查询和桌面/移动主从导航。
import type { DocumentVersionSummary } from "@sharebrain/contracts";
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
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { DocumentVersionHistoryList } from "./document-version-history-list";
import { useDocumentVersionDetail, useDocumentVersionList } from "./document-version-history.queries";
import { restoreDocumentVersion } from "./document-version-history.restore";
import {
  CURRENT_DOCUMENT_VERSION_KEY,
  createInitialDocumentVersionHistoryState,
  documentVersionHistoryReducer,
} from "./document-version-history.state";

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

type DocumentVersionHistoryProps = {
  documentId: string;
  initialSelectedKey?: string;
  currentActor: DocumentVersionSummary["lastEditor"];
  memberAvatarUrls: Readonly<Record<string, string>>;
  canRestore: boolean;
  getCollabProvider: () => HocuspocusProviderWrapper | null;
  getLiveBaseStateVector: () => string;
  getLiveValue: () => Value;
  onClose: () => void;
};

const emptyCurrentValue: Value = [{ type: "p", children: [{ text: "" }] }];

export function DocumentVersionHistory({
  documentId,
  initialSelectedKey = CURRENT_DOCUMENT_VERSION_KEY,
  currentActor,
  memberAvatarUrls,
  canRestore,
  getCollabProvider,
  getLiveBaseStateVector,
  getLiveValue,
  onClose,
}: DocumentVersionHistoryProps) {
  const rootRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const [currentValue, setCurrentValue] = useState(emptyCurrentValue);
  const [currentValueLoading, setCurrentValueLoading] = useState(
    initialSelectedKey === CURRENT_DOCUMENT_VERSION_KEY,
  );
  const [confirmMode, setConfirmMode] = useState<"normal" | "force" | null>(null);
  const [executing, setExecuting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(
    documentVersionHistoryReducer,
    createInitialDocumentVersionHistoryState(initialSelectedKey),
  );
  const list = useDocumentVersionList(documentId, true);
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const selectedVersion = items.find((item) => item.id === state.selectedKey);
  const selectedVersionId =
    state.selectedKey === CURRENT_DOCUMENT_VERSION_KEY ? null : state.selectedKey;
  const detail = useDocumentVersionDetail(documentId, selectedVersionId, true);
  const selectedLabel = selectedVersion
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(selectedVersion.sealedAt),
      )
    : m.document_version_current();
  const comparisonLabel = detail.data
    ? detail.data.previousVersionNo
      ? m.document_version_compare_previous({
          previous: String(detail.data.previousVersionNo),
          current: String(detail.data.versionNo),
        })
      : m.document_version_compare_initial({ current: String(detail.data.versionNo) })
    : undefined;
  const restoreDisabled =
    !canRestore ||
    !selectedVersionId ||
    !detail.data ||
    detail.data.unavailableMediaCount > 0 ||
    executing;

  useEffect(() => {
    if (state.selectedKey !== CURRENT_DOCUMENT_VERSION_KEY) return;

    setCurrentValueLoading(true);
    const timer = window.setTimeout(() => {
      setCurrentValue(getLiveValue());
      setCurrentValueLoading(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [getLiveValue, state.selectedKey]);

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
        onClose();
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
  }, [onClose]);

  const performRestore = async (force: boolean) => {
    if (!selectedVersionId) return;
    const provider = getCollabProvider();
    if (!provider) {
      setRestoreError(m.document_version_collab_unavailable());
      return;
    }
    setExecuting(true);
    setRestoreError(null);
    try {
      const operation = await restoreDocumentVersion({
        documentId,
        versionId: selectedVersionId,
        baseStateVector: getLiveBaseStateVector(),
        provider,
        force,
      });
      if (operation.status === "conflict") {
        setCurrentValue(getLiveValue());
        setConfirmMode("force");
        return;
      }
      if (operation.status !== "applied") {
        throw new Error(operation.errorCode ?? operation.status);
      }
      await queryClient.invalidateQueries({ queryKey: ["documents", documentId, "versions"] });
      toast.success(m.document_version_restore_applied());
      onClose();
    } catch {
      setRestoreError(m.document_version_restore_failed());
      toast.error(m.document_version_restore_failed());
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-version-history-title"
      aria-busy={executing}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex min-h-0 flex-col bg-background text-foreground outline-none"
    >
      <NotionToolbar className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto] border-b border-border-subtle px-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-label={m.document_version_back_to_list()}
            onClick={() => dispatch({ type: "show-list" })}
          >
            <ArrowLeft size={16} />
          </Button>
          <strong
            id="document-version-history-title"
            className="truncate text-[13px] font-medium"
          >
            {m.document_version_title()}
          </strong>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {selectedLabel}</span>
        </div>
        <NotionSegmentedControl className="hidden sm:inline-flex">
          <NotionSegmentedButton
            active={state.mode === "preview"}
            onClick={() => dispatch({ type: "set-mode", mode: "preview" })}
          >
            {m.document_version_preview()}
          </NotionSegmentedButton>
          <NotionSegmentedButton
            active={state.mode === "changes"}
            disabled={!selectedVersionId}
            onClick={() => dispatch({ type: "set-mode", mode: "changes" })}
          >
            {m.document_version_changes()}
          </NotionSegmentedButton>
        </NotionSegmentedControl>
        <div className="flex items-center justify-self-end gap-1">
          {selectedVersionId && canRestore ? (
            <Button
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] max-sm:grid-cols-1">
        <main
          className={`${state.mobilePane === "content" ? "block" : "max-sm:hidden"} min-h-0 overflow-y-auto`}
        >
          <div className="border-b border-border-subtle p-2 sm:hidden">
            <NotionSegmentedControl>
              <NotionSegmentedButton
                active={state.mode === "preview"}
                onClick={() => dispatch({ type: "set-mode", mode: "preview" })}
              >
                {m.document_version_preview()}
              </NotionSegmentedButton>
              <NotionSegmentedButton
                active={state.mode === "changes"}
                disabled={!selectedVersionId}
                onClick={() => dispatch({ type: "set-mode", mode: "changes" })}
              >
                {m.document_version_changes()}
              </NotionSegmentedButton>
            </NotionSegmentedControl>
          </div>
          <Suspense fallback={<DocumentVersionHistoryContentFallback />}>
            <DocumentVersionHistoryContent
              value={(detail.data?.value as Value | undefined) ?? currentValue}
              {...(detail.data
                ? { previousValue: (detail.data.previousValue ?? []) as Value }
                : {})}
              mode={state.mode}
              {...(comparisonLabel ? { comparisonLabel } : {})}
              loading={selectedVersionId ? detail.isLoading : currentValueLoading}
              error={detail.isError}
              onRetry={() => void detail.refetch()}
            />
          </Suspense>
        </main>
        <div
          className={`${state.mobilePane === "list" ? "block" : "max-sm:hidden"} min-h-0 border-l border-border-subtle max-sm:border-l-0`}
        >
          <DocumentVersionHistoryList
            items={items}
            selectedKey={state.selectedKey}
            currentActor={currentActor}
            memberAvatarUrls={memberAvatarUrls}
            loading={list.isLoading}
            hasMore={list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            onSelect={(key) => {
              if (!executing) dispatch({ type: "select", key });
            }}
          />
        </div>
      </div>
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
                : m.document_version_restore_description()}
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
