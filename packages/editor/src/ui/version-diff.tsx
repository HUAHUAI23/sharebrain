// 延迟计算并只读展示两个 Plate Value 的差异，超出预算时稳定降级。
import { useEffect, useMemo } from 'react';
import type { Value } from 'platejs';

import { BaseEditorKit } from '../editor-base-kit';
import { VersionDiffKit } from '../kits/version-diff-kit';
import {
  computeEditorVersionDiff,
  estimateEditorVersionValue,
} from '../lib/version-history';
import { VersionPreview } from './version-preview';

export type VersionDiffProps = {
  previous: Value;
  current: Value;
  maxNodes?: number;
  maxBytes?: number;
  className?: string;
  onLimitExceeded?: () => void;
};

export function VersionDiff({
  previous,
  current,
  maxNodes = 50_000,
  maxBytes = 5 * 1024 * 1024,
  className,
  onLimitExceeded,
}: VersionDiffProps) {
  const exceedsLimit = useMemo(() => {
    const previousEstimate = estimateEditorVersionValue(previous);
    const currentEstimate = estimateEditorVersionValue(current);
    return (
      previousEstimate.nodes + currentEstimate.nodes > maxNodes ||
      previousEstimate.bytes + currentEstimate.bytes > maxBytes
    );
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
            plugins: [...BaseEditorKit, ...VersionDiffKit],
          }),
    [current, exceedsLimit, previous]
  );

  return (
    <VersionPreview
      value={value}
      plugins={exceedsLimit ? BaseEditorKit : [...BaseEditorKit, ...VersionDiffKit]}
      {...(className ? { className } : {})}
    />
  );
}
