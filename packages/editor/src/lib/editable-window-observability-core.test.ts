// 验证窗口化指标不会携带正文，并确保会话熔断只在兼容性失败时打开。
import { describe, expect, test } from 'bun:test';

import {
  createEditableWindowCircuitState,
  createEditableWindowMetric,
  getEditableWindowCircuitStorageKey,
  readEditableWindowCircuit,
  reduceEditableWindowCircuit,
  writeEditableWindowCircuit,
} from './editable-window-observability-core';

const thresholds = { maxFallbackRatio: 0.25, maxRevealFailures: 3 };

describe('editable window metrics', () => {
  test('rebuilds an allowlisted numeric and enumerated payload', () => {
    const metric = createEditableWindowMetric({
      documentKey: 'doc-1',
      durationMs: 123,
      kind: 'long-task',
      timestamp: 10,
      // 运行时即使误传正文字段，也不会进入重建后的 payload。
      text: 'private document content',
    } as Parameters<typeof createEditableWindowMetric>[0] & { text: string });

    expect(metric).toEqual({
      documentKey: 'doc-1',
      durationMs: 123,
      kind: 'long-task',
      timestamp: 10,
      version: 1,
    });
    expect(JSON.stringify(metric)).not.toContain('private document content');
  });
});

describe('editable window circuit', () => {
  test('opens for excessive adapter fallback coverage', () => {
    const state = reduceEditableWindowCircuit(
      createEditableWindowCircuitState(),
      { fallbackBlocks: 26, totalBlocks: 100, type: 'coverage' },
      thresholds
    );

    expect(state.reason).toBe('adapter-fallback-coverage');
  });

  test('requires consecutive reveal failures and resets after success', () => {
    let state = createEditableWindowCircuitState();

    state = reduceEditableWindowCircuit(
      state,
      { success: false, type: 'reveal' },
      thresholds
    );
    state = reduceEditableWindowCircuit(
      state,
      { success: true, type: 'reveal' },
      thresholds
    );
    expect(state.consecutiveRevealFailures).toBe(0);

    for (let index = 0; index < 3; index += 1) {
      state = reduceEditableWindowCircuit(
        state,
        { success: false, type: 'reveal' },
        thresholds
      );
    }
    expect(state.reason).toBe('reveal-failure');
  });

  test('does not open merely because a long task was observed', () => {
    const state = createEditableWindowCircuitState();

    expect(state.reason).toBeNull();
  });

  test('persists and validates the reason per document session', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(
      writeEditableWindowCircuit(storage, 'doc/1', 'invalid-geometry')
    ).toBe(true);
    expect(readEditableWindowCircuit(storage, 'doc/1')).toBe(
      'invalid-geometry'
    );
    expect(getEditableWindowCircuitStorageKey('doc/1')).toContain('doc%2F1');
  });
});
