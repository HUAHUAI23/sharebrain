// 延迟计算并只读展示两个 Plate Value 的差异，超出预算时稳定降级。
import { useEffect, useMemo } from 'react';
import type { Value } from 'platejs';

import { BaseEditorKit } from '../editor-base-kit';
import { VersionDiffKit } from '../kits/version-diff-kit';
import {
  EDITOR_VERSION_DIFF_INPUT_BUDGET,
  computeEditorVersionDiff,
  isEditorVersionDiffWithinBudget,
} from '../lib/version-history';
import { VersionPreview } from './version-preview';

const versionDiffEditorKit = [...BaseEditorKit, ...VersionDiffKit];

export type VersionDiffProps = {
  previous: Value;
  current: Value;
  maxNodes?: number;
  maxBytes?: number;
  className?: string;
  onLimitExceeded?: () => void;
};

export type VersionDiffPreviewProps = {
  value: Value;
  className?: string;
};

export function VersionDiffPreview({
  value,
  className,
}: VersionDiffPreviewProps) {
  return (
    <VersionPreview
      value={value}
      plugins={versionDiffEditorKit}
      {...(className ? { className } : {})}
    />
  );
}

export function VersionDiff({
  previous,
  current,
  maxNodes = EDITOR_VERSION_DIFF_INPUT_BUDGET.maxNodes,
  maxBytes = EDITOR_VERSION_DIFF_INPUT_BUDGET.maxBytes,
  className,
  onLimitExceeded,
}: VersionDiffProps) {
  const exceedsLimit = useMemo(() => {
    return !isEditorVersionDiffWithinBudget({
      previous,
      current,
      budget: { maxBytes, maxNodes },
    });
  }, [current, maxBytes, maxNodes, previous]);

  useEffect(() => {
    if (exceedsLimit) onLimitExceeded?.();
  }, [exceedsLimit, onLimitExceeded]);

  const value = useMemo(
    () =>
      exceedsLimit
        ? current
        : computeEditorVersionDiff({
            previous,
            current,
            plugins: versionDiffEditorKit,
          }),
    [current, exceedsLimit, previous]
  );

  return (
    <VersionPreview
      value={value}
      plugins={exceedsLimit ? BaseEditorKit : versionDiffEditorKit}
      {...(className ? { className } : {})}
    />
  );
}
