// 定义大文档窗口化的无正文指标、会话熔断状态和持久化协议。
export const EDITABLE_WINDOW_METRIC_EVENT =
  'sharebrain:editor-windowing-metric';

export const editableWindowCircuitReasons = [
  'adapter-fallback-coverage',
  'adapter-invariant',
  'invalid-geometry',
  'reveal-failure',
] as const;

export type EditableWindowCircuitReason =
  (typeof editableWindowCircuitReasons)[number];

export type EditableWindowMetricKind =
  | 'circuit-open'
  | 'coverage'
  | 'long-task'
  | 'ready'
  | 'reveal'
  | 'start';

export type EditableWindowMetric = {
  documentKey: string;
  kind: EditableWindowMetricKind;
  timestamp: number;
  version: 1;
  durationMs?: number;
  fallbackBlocks?: number;
  mountedChunks?: number;
  placeholderChunks?: number;
  reason?: EditableWindowCircuitReason;
  success?: boolean;
  totalBlocks?: number;
};

export type EditableWindowCircuitState = {
  consecutiveRevealFailures: number;
  reason: EditableWindowCircuitReason | null;
};

export type EditableWindowCircuitSignal =
  | {
      fallbackBlocks: number;
      totalBlocks: number;
      type: 'coverage';
    }
  | { type: 'invalid-geometry' }
  | { type: 'invariant' }
  | { success: boolean; type: 'reveal' };

export type EditableWindowCircuitThresholds = {
  maxFallbackRatio: number;
  maxRevealFailures: number;
};

type EditableWindowMetricInput = Omit<
  EditableWindowMetric,
  'timestamp' | 'version'
> & {
  timestamp?: number;
};

const finiteNumber = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, value) : undefined;

export function createEditableWindowMetric(
  input: EditableWindowMetricInput
): EditableWindowMetric {
  const metric: EditableWindowMetric = {
    documentKey: input.documentKey,
    kind: input.kind,
    timestamp: finiteNumber(input.timestamp) ?? Date.now(),
    version: 1,
  };
  const durationMs = finiteNumber(input.durationMs);
  const fallbackBlocks = finiteNumber(input.fallbackBlocks);
  const mountedChunks = finiteNumber(input.mountedChunks);
  const placeholderChunks = finiteNumber(input.placeholderChunks);
  const totalBlocks = finiteNumber(input.totalBlocks);

  if (durationMs !== undefined) metric.durationMs = durationMs;
  if (fallbackBlocks !== undefined) metric.fallbackBlocks = fallbackBlocks;
  if (mountedChunks !== undefined) metric.mountedChunks = mountedChunks;
  if (placeholderChunks !== undefined) {
    metric.placeholderChunks = placeholderChunks;
  }
  if (totalBlocks !== undefined) metric.totalBlocks = totalBlocks;
  if (typeof input.success === 'boolean') metric.success = input.success;
  if (
    input.reason &&
    editableWindowCircuitReasons.includes(input.reason)
  ) {
    metric.reason = input.reason;
  }

  return metric;
}

export function createEditableWindowCircuitState(
  reason: EditableWindowCircuitReason | null = null
): EditableWindowCircuitState {
  return { consecutiveRevealFailures: 0, reason };
}

export function reduceEditableWindowCircuit(
  state: EditableWindowCircuitState,
  signal: EditableWindowCircuitSignal,
  thresholds: EditableWindowCircuitThresholds
): EditableWindowCircuitState {
  if (state.reason) return state;

  if (signal.type === 'invariant') {
    return { ...state, reason: 'adapter-invariant' };
  }
  if (signal.type === 'invalid-geometry') {
    return { ...state, reason: 'invalid-geometry' };
  }
  if (signal.type === 'coverage') {
    const ratio =
      signal.totalBlocks > 0
        ? signal.fallbackBlocks / signal.totalBlocks
        : 0;

    return ratio > Math.max(0, thresholds.maxFallbackRatio)
      ? { ...state, reason: 'adapter-fallback-coverage' }
      : state;
  }

  if (signal.success) {
    return state.consecutiveRevealFailures === 0
      ? state
      : { ...state, consecutiveRevealFailures: 0 };
  }

  const consecutiveRevealFailures = state.consecutiveRevealFailures + 1;

  return {
    consecutiveRevealFailures,
    reason:
      consecutiveRevealFailures >= Math.max(1, thresholds.maxRevealFailures)
        ? 'reveal-failure'
        : null,
  };
}

export function getEditableWindowCircuitStorageKey(documentKey: string) {
  return `sharebrain:editor-windowing:circuit:${encodeURIComponent(documentKey)}`;
}

export function readEditableWindowCircuit(
  storage: Pick<Storage, 'getItem'> | null,
  documentKey: string
): EditableWindowCircuitReason | null {
  if (!storage || !documentKey) return null;

  try {
    const value = storage.getItem(
      getEditableWindowCircuitStorageKey(documentKey)
    );
    if (!value) return null;

    const parsed = JSON.parse(value) as { reason?: unknown; version?: unknown };

    return parsed.version === 1 &&
      typeof parsed.reason === 'string' &&
      editableWindowCircuitReasons.includes(
        parsed.reason as EditableWindowCircuitReason
      )
      ? (parsed.reason as EditableWindowCircuitReason)
      : null;
  } catch {
    return null;
  }
}

export function writeEditableWindowCircuit(
  storage: Pick<Storage, 'setItem'> | null,
  documentKey: string,
  reason: EditableWindowCircuitReason
) {
  if (!storage || !documentKey) return false;

  try {
    storage.setItem(
      getEditableWindowCircuitStorageKey(documentKey),
      JSON.stringify({ reason, version: 1 })
    );
    return true;
  } catch {
    return false;
  }
}
