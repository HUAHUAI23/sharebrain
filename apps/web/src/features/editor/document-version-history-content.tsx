// 组合 Worker Diff、变更上下文和只读预览，并覆盖加载、错误和超限状态。
import { VersionDiffPreview } from "@sharebrain/editor/ui/version-diff";
import { VersionDiffLegend } from "@sharebrain/editor/ui/version-diff-legend";
import { VersionPreview } from "@sharebrain/editor/ui/version-preview";
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { Skeleton } from "@sharebrain/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sharebrain/ui/components/tooltip";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Value } from "platejs";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDocumentVersionDiff } from "./document-version-diff";

type DocumentVersionHistoryContentProps = {
  value: Value;
  previousValue?: Value;
  mode: "preview" | "changes";
  comparisonLabel?: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

export function DocumentVersionHistoryContent({
  value,
  previousValue,
  mode,
  comparisonLabel,
  loading,
  error,
  onRetry,
}: DocumentVersionHistoryContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const changeIndexRef = useRef(0);
  const [changeCount, setChangeCount] = useState(0);
  const [changeIndex, setChangeIndex] = useState(0);
  const diff = useDocumentVersionDiff({
    current: value,
    enabled: Boolean(previousValue) && !loading && !error,
    ...(previousValue ? { previous: previousValue } : {}),
  });
  const diffLimited = diff.status === "limited";
  const diffError = diff.status === "error";

  const getChangeElements = useCallback(() => {
    const root = contentRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-version-diff]")).filter(
      (element) => {
        const parentMarker = element.parentElement?.closest<HTMLElement>("[data-version-diff]");
        return !parentMarker || !root.contains(parentMarker);
      },
    );
  }, []);

  const markActiveChange = useCallback((elements: HTMLElement[], index: number) => {
    elements.forEach((element, elementIndex) => {
      element.toggleAttribute("data-version-diff-active", elementIndex === index);
    });
  }, []);

  useEffect(() => {
    setChangeCount(0);
    setChangeIndex(0);
    changeIndexRef.current = 0;
  }, [mode, previousValue, value]);

  useEffect(() => {
    const root = contentRef.current;
    if (
      !root ||
      mode !== "changes" ||
      !previousValue ||
      diff.status !== "ready" ||
      diff.segments.length === 0
    ) {
      return;
    }

    let frame = 0;
    const syncChanges = () => {
      const elements = getChangeElements();
      const nextIndex = Math.min(changeIndexRef.current, Math.max(elements.length - 1, 0));
      changeIndexRef.current = nextIndex;
      setChangeIndex(nextIndex);
      setChangeCount(elements.length);
      markActiveChange(elements, nextIndex);
    };
    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncChanges);
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(root, { childList: true, subtree: true });
    scheduleSync();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      getChangeElements().forEach((element) => {
        element.removeAttribute("data-version-diff-active");
      });
    };
  }, [diff, getChangeElements, markActiveChange, mode, previousValue, value]);

  const navigateToChange = (offset: number) => {
    const elements = getChangeElements();
    if (elements.length === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(changeIndexRef.current + offset, elements.length - 1),
    );
    changeIndexRef.current = nextIndex;
    setChangeIndex(nextIndex);
    setChangeCount(elements.length);
    markActiveChange(elements, nextIndex);
    elements[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-[820px] gap-4 px-6 py-10 sm:px-12 lg:px-20">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <NotionEmpty className="grid min-h-48 place-content-center gap-3 text-center">
        <span>{m.document_version_detail_error()}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.common_retry()}
        </Button>
      </NotionEmpty>
    );
  }

  return (
    <div ref={contentRef} className="mx-auto w-full max-w-[820px] px-6 py-10 sm:px-12 lg:px-20">
      {mode === "changes" && previousValue ? (
        <div className="sticky top-0 z-10 -mx-2 mb-6 grid gap-2 border-b border-border-subtle bg-background/95 px-2 py-2 backdrop-blur-sm">
          <div className="flex min-h-7 min-w-0 items-center justify-between gap-3">
            {comparisonLabel ? (
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {comparisonLabel}
              </span>
            ) : <span />}
            {!diffLimited && changeCount > 0 ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <span
                  className="mr-1 text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                >
                  {m.document_version_change_position({
                    current: String(changeIndex + 1),
                    total: String(changeCount),
                  })}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={m.document_version_previous_change()}
                      disabled={changeIndex === 0}
                      onClick={() => navigateToChange(-1)}
                    >
                      <ChevronUp size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{m.document_version_previous_change()}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={m.document_version_next_change()}
                      disabled={changeIndex >= changeCount - 1}
                      onClick={() => navigateToChange(1)}
                    >
                      <ChevronDown size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{m.document_version_next_change()}</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>
          <VersionDiffLegend
            labels={{
              insert: m.document_version_inserted(),
              delete: m.document_version_deleted(),
              update: m.document_version_updated(),
            }}
          />
          {diff.status === "computing" ? (
            <span className="text-xs text-muted-foreground">
              {m.document_version_diff_calculating()}
            </span>
          ) : diffLimited ? (
            <span className="text-xs text-muted-foreground">{m.document_version_diff_too_large()}</span>
          ) : diffError ? (
            <span className="text-xs text-destructive">{m.document_version_diff_error()}</span>
          ) : null}
        </div>
      ) : null}
      {mode === "changes" && previousValue ? (
        diff.status === "computing" || diff.status === "idle" ? (
          <div className="grid gap-4 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : diff.status === "ready" && diff.segments.length > 0 ? (
          <div className="min-h-[56vh] w-full">
            {diff.segments.map((segment, index) => (
              <div key={`${segment.startIndex}:${segment.endIndex}`}>
                {segment.omittedBefore > 0 ? (
                  <DiffOmission count={segment.omittedBefore} />
                ) : null}
                <VersionDiffPreview
                  value={segment.value}
                  className="w-full text-base leading-7 text-foreground"
                />
                {index === diff.segments.length - 1 && segment.omittedAfter > 0 ? (
                  <DiffOmission count={segment.omittedAfter} />
                ) : null}
              </div>
            ))}
          </div>
        ) : diff.status === "ready" ? (
          <NotionEmpty className="grid min-h-[56vh] place-content-center text-center">
            {m.document_version_no_changes()}
          </NotionEmpty>
        ) : (
          <div className="grid min-h-[56vh] content-start gap-3">
            {diffError ? (
              <Button variant="outline" size="sm" className="w-fit" onClick={diff.retry}>
                {m.common_retry()}
              </Button>
            ) : null}
            <VersionPreview
              value={value}
              className="w-full text-base leading-7 text-foreground"
            />
          </div>
        )
      ) : (
        <VersionPreview
          value={value}
          className="min-h-[56vh] w-full text-base leading-7 text-foreground"
        />
      )}
    </div>
  );
}

function DiffOmission({ count }: { count: number }) {
  return (
    <div
      className="my-5 flex items-center gap-3 text-xs text-muted-foreground"
      contentEditable={false}
    >
      <span className="h-px flex-1 bg-border-subtle" />
      <span>{m.document_version_unchanged_blocks({ count: String(count) })}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
