// 验证评论索引只通知变化块，并为无标记普通输入保留零扫描路径。
import { describe, expect, test } from 'bun:test';

import type { TDiscussion } from '../kits/discussion-kit';
import {
  BlockDiscussionIndexStore,
  canReuseEmptyDiscussionIndex,
  type BlockDiscussionIndex,
  type ResolvedSuggestion,
} from './block-discussion-index';

const emptyIndex = (): BlockDiscussionIndex => ({
  commentIds: new Set(),
  discussionsByBlock: new Map(),
  suggestionsByBlock: new Map(),
});

const discussion: TDiscussion = {
  id: 'discussion-1',
  comments: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  isResolved: false,
  updatedAt: '2026-07-15T00:00:00.000Z',
  userId: 'user-1',
};

describe('BlockDiscussionIndexStore', () => {
  test('keeps empty snapshots stable and only notifies changed blocks', () => {
    const store = new BlockDiscussionIndexStore();
    const initialEmpty = store.getBlockItems('0');
    let notifications = 0;
    const unsubscribe = store.subscribeBlock('0', () => notifications++);

    store.update(emptyIndex(), []);
    expect(store.getBlockItems('0')).toBe(initialEmpty);
    expect(notifications).toBe(0);

    const populated: BlockDiscussionIndex = {
      ...emptyIndex(),
      commentIds: new Set([discussion.id]),
      discussionsByBlock: new Map([['0', [discussion]]]),
    };

    store.update(populated, [discussion]);
    expect(notifications).toBe(1);
    expect(store.getBlockItems('0').resolvedDiscussions).toEqual([
      discussion,
    ]);

    store.update(populated, [discussion]);
    expect(notifications).toBe(1);

    store.update(emptyIndex(), []);
    expect(notifications).toBe(2);
    expect(store.getBlockItems('0')).toBe(initialEmpty);

    unsubscribe();
  });

  test('publishes present comment ids independently from block snapshots', () => {
    const store = new BlockDiscussionIndexStore();
    let notifications = 0;
    const unsubscribe = store.subscribeCommentIds(() => notifications++);

    store.update(
      {
        ...emptyIndex(),
        commentIds: new Set(['comment-2', 'comment-1']),
      },
      []
    );

    expect(store.getCommentIds()).toEqual(['comment-1', 'comment-2']);
    expect(notifications).toBe(1);
    expect(store.empty).toBe(false);

    store.update(
      {
        ...emptyIndex(),
        commentIds: new Set(['comment-1', 'comment-2']),
      },
      []
    );
    expect(notifications).toBe(1);

    unsubscribe();
  });

  test('notifies the editor-level gate only when presence changes', () => {
    const store = new BlockDiscussionIndexStore();
    let notifications = 0;
    const unsubscribe = store.subscribePresence(() => notifications++);

    store.update(emptyIndex(), []);
    expect(store.getPresent()).toBe(false);
    expect(notifications).toBe(0);

    store.update(
      {
        ...emptyIndex(),
        discussionsByBlock: new Map([['0', [discussion]]]),
      },
      [discussion]
    );
    expect(store.getPresent()).toBe(true);
    expect(notifications).toBe(1);

    store.update(
      {
        ...emptyIndex(),
        discussionsByBlock: new Map([['0', [discussion]]]),
      },
      [discussion]
    );
    expect(notifications).toBe(1);

    store.update(emptyIndex(), []);
    expect(store.getPresent()).toBe(false);
    expect(notifications).toBe(2);

    unsubscribe();
  });

  test('notifies a block when an update suggestion changes properties', () => {
    const store = new BlockDiscussionIndexStore();
    const comments: ResolvedSuggestion['comments'] = [];
    const suggestion = (newType: string): ResolvedSuggestion => ({
      comments,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      keyId: 'suggestion_suggestion-1',
      newProperties: { type: newType },
      newText: 'Heading',
      properties: { type: 'p' },
      suggestionId: 'suggestion-1',
      type: 'update',
      userId: 'user-1',
    });
    const index = (item: ResolvedSuggestion): BlockDiscussionIndex => ({
      ...emptyIndex(),
      suggestionsByBlock: new Map([['0', [item]]]),
    });
    let notifications = 0;
    const unsubscribe = store.subscribeBlock('0', () => notifications++);

    store.update(index(suggestion('h2')), []);
    expect(notifications).toBe(1);

    store.update(index(suggestion('h2')), []);
    expect(notifications).toBe(1);

    store.update(index(suggestion('h3')), []);
    expect(notifications).toBe(2);

    unsubscribe();
  });
});

describe('canReuseEmptyDiscussionIndex', () => {
  const base = {
    discussionsChanged: false,
    discussionsEmpty: true,
    indexEmpty: true,
    initialized: true,
  };

  test('reuses the index for unmarked text and selection operations', () => {
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [{ type: 'set_selection' }, { type: 'insert_text' }],
        operationHasData: () => false,
      })
    ).toBe(true);
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [
          { type: 'split_node' },
          { type: 'set_selection' },
        ],
        operationHasData: () => false,
      })
    ).toBe(true);
  });

  test('reuses safe structural operations and refreshes when they add marks', () => {
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [{ type: 'insert_text' }],
        operationHasData: () => true,
      })
    ).toBe(false);
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [{ type: 'insert_node' }],
        operationHasData: () => false,
      })
    ).toBe(true);
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [{ type: 'set_node' }],
        operationHasData: () => true,
      })
    ).toBe(false);
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        operations: [{ type: 'remove_node' }, { type: 'move_node' }],
        operationHasData: () => false,
      })
    ).toBe(true);
  });

  test('refreshes when discussions change', () => {
    expect(
      canReuseEmptyDiscussionIndex({
        ...base,
        discussionsChanged: true,
        operations: [{ type: 'insert_text' }],
        operationHasData: () => false,
      })
    ).toBe(false);
  });
});
