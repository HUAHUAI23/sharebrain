// 为顶层正文块构建评论和建议索引，避免选区变化触发全文扫描。
import * as React from 'react';

import type { TResolvedSuggestion } from '@platejs/suggestion';
import type { PlateEditor } from 'platejs/react';

import { CommentPlugin } from '@platejs/comment/react';
import { getSuggestionKey, keyId2SuggestionId } from '@platejs/suggestion';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  type NodeEntry,
  NodeApi,
  type Path,
  type TCommentText,
  type TElement,
  type TNode,
  type TSuggestionText,
  ElementApi,
  KEYS,
  PathApi,
  TextApi,
} from 'platejs';
import { useEditorRef } from 'platejs/react';

import type { TDiscussion } from '../kits/discussion-kit';

import type { TComment } from '../ui/comment';

export interface ResolvedSuggestion extends TResolvedSuggestion {
  comments: TComment[];
}

export const BLOCK_SUGGESTION_TOKEN = '__block__';

type BlockDiscussionEntry = NodeEntry<
  TCommentText | TElement | TSuggestionText
>;
type SuggestionEntry = NodeEntry<TElement | TSuggestionText>;

export type BlockDiscussionIndex = {
  commentIds: Set<string>;
  discussionsByBlock: Map<string, TDiscussion[]>;
  suggestionsByBlock: Map<string, ResolvedSuggestion[]>;
};

export type BlockDiscussionItems = {
  resolvedDiscussions: TDiscussion[];
  resolvedSuggestions: ResolvedSuggestion[];
};

type BuildBlockDiscussionIndexOptions = {
  entries: BlockDiscussionEntry[];
  discussions: TDiscussion[];
  getCommentId: (node: TCommentText) => string | undefined;
  getSuggestionData: (node: TElement | TSuggestionText) =>
    | {
        createdAt: Date | number | string;
        id: string;
        isLineBreak?: boolean;
        newProperties?: Record<string, unknown>;
        properties?: Record<string, unknown>;
        type: 'insert' | 'remove' | 'update';
        userId: string;
      }
    | undefined;
  getSuggestionDataList: (node: TSuggestionText) => Array<{
    id: string;
    newProperties?: Record<string, unknown>;
    properties?: Record<string, unknown>;
    type: 'insert' | 'remove' | 'update';
  }>;
  getSuggestionId: (node: TElement | TSuggestionText) => string | undefined;
  isBlockSuggestion: (node: TElement | TSuggestionText) => boolean;
};

const EMPTY_DISCUSSIONS: TDiscussion[] = [];
const EMPTY_COMMENTS: TComment[] = [];
const EMPTY_SUGGESTIONS: ResolvedSuggestion[] = [];
const EMPTY_BLOCK_DISCUSSION_ITEMS: BlockDiscussionItems = {
  resolvedDiscussions: EMPTY_DISCUSSIONS,
  resolvedSuggestions: EMPTY_SUGGESTIONS,
};
const EMPTY_COMMENT_IDS: readonly string[] = [];

const TYPE_TEXT_MAP: Record<string, (node?: TElement) => string> = {
  [KEYS.audio]: () => 'Audio',
  [KEYS.blockquote]: () => 'Blockquote',
  [KEYS.callout]: () => 'Callout',
  [KEYS.codeBlock]: () => 'Code Block',
  [KEYS.column]: () => 'Column',
  [KEYS.equation]: () => 'Equation',
  [KEYS.file]: () => 'File',
  [KEYS.h1]: () => 'Heading 1',
  [KEYS.h2]: () => 'Heading 2',
  [KEYS.h3]: () => 'Heading 3',
  [KEYS.h4]: () => 'Heading 4',
  [KEYS.h5]: () => 'Heading 5',
  [KEYS.h6]: () => 'Heading 6',
  [KEYS.hr]: () => 'Horizontal Rule',
  [KEYS.img]: () => 'Image',
  [KEYS.mediaEmbed]: () => 'Media',
  [KEYS.p]: (node) => {
    if (node?.[KEYS.listType] === KEYS.listTodo) return 'Todo List';
    if (node?.[KEYS.listType] === KEYS.ol) return 'Ordered List';
    if (node?.[KEYS.listType] === KEYS.ul) return 'List';

    return 'Paragraph';
  },
  [KEYS.table]: () => 'Table',
  [KEYS.toc]: () => 'Table of Contents',
  [KEYS.toggle]: () => 'Toggle',
  [KEYS.video]: () => 'Video',
};

const appendByKey = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const values = map.get(key);

  if (values) {
    values.push(value);
    return;
  }

  map.set(key, [value]);
};

const getBlockKey = (path: Path) => path.join(',');

const getTopLevelPath = (path: Path): Path | null =>
  path.length > 0 ? path.slice(0, 1) : null;

const getSuggestionIds = (
  node: TCommentText | TElement | TSuggestionText,
  getSuggestionDataList: BuildBlockDiscussionIndexOptions['getSuggestionDataList'],
  getSuggestionId: BuildBlockDiscussionIndexOptions['getSuggestionId']
) => {
  if (TextApi.isText(node)) {
    const dataList = getSuggestionDataList(node as TSuggestionText);
    const updateIds = dataList
      .filter((data) => data.type === 'update')
      .map((data) => data.id);

    if (updateIds.length > 0) return updateIds;

    const suggestionId = getSuggestionId(node as TSuggestionText);

    return suggestionId ? [suggestionId] : [];
  }

  if (ElementApi.isElement(node)) {
    const suggestionId = getSuggestionId(node);

    return suggestionId ? [suggestionId] : [];
  }

  return [];
};

const suggestionTypeText = (node: TElement) =>
  (TYPE_TEXT_MAP[node.type] ?? (() => node.type))(node);

const formatSuggestionDateText = (date: string) => {
  const elementDate = new Date(date);

  if (Number.isNaN(elementDate.getTime())) return date;

  const today = new Date();
  const yesterday = new Date(today);
  const tomorrow = new Date(today);

  yesterday.setDate(today.getDate() - 1);
  tomorrow.setDate(today.getDate() + 1);

  const sameDay = (left: Date, right: Date) =>
    left.getDate() === right.getDate() &&
    left.getMonth() === right.getMonth() &&
    left.getFullYear() === right.getFullYear();

  if (sameDay(elementDate, today)) return 'Today';
  if (sameDay(elementDate, yesterday)) return 'Yesterday';
  if (sameDay(elementDate, tomorrow)) return 'Tomorrow';

  return elementDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const getInlineSuggestionElementText = (node: TElement) => {
  if (typeof node.value === 'string' && node.value.length > 0) {
    return node.value;
  }

  if (typeof node.date === 'string' && node.date.length > 0) {
    return formatSuggestionDateText(node.date);
  }

  if (
    node.type === KEYS.inlineEquation &&
    typeof (node as TElement & { texExpression?: unknown }).texExpression ===
      'string' &&
    (node as TElement & { texExpression: string }).texExpression.length > 0
  ) {
    return (node as TElement & { texExpression: string }).texExpression;
  }

  const nodeText = NodeApi.string(node);

  if (nodeText.length > 0) {
    return nodeText;
  }
};

const toResolvedSuggestion = ({
  discussionsById,
  entries,
  getSuggestionData,
  getSuggestionDataList,
  id,
  isBlockSuggestion,
}: {
  discussionsById: Map<string, TDiscussion>;
  entries: SuggestionEntry[];
  getSuggestionData: BuildBlockDiscussionIndexOptions['getSuggestionData'];
  getSuggestionDataList: BuildBlockDiscussionIndexOptions['getSuggestionDataList'];
  id: string;
  isBlockSuggestion: BuildBlockDiscussionIndexOptions['isBlockSuggestion'];
}): ResolvedSuggestion | null => {
  const sortedEntries = [...entries].sort(([, path1], [, path2]) =>
    PathApi.isChild(path1, path2) ? -1 : 1
  );

  if (sortedEntries.length === 0) return null;

  let newText = '';
  let text = '';
  let properties: Record<string, unknown> = {};
  let newProperties: Record<string, unknown> = {};

  sortedEntries.forEach(([node]) => {
    if (TextApi.isText(node)) {
      getSuggestionDataList(node as TSuggestionText).forEach((data) => {
        if (data.id !== id) return;

        switch (data.type) {
          case 'insert': {
            newText += node.text;
            break;
          }
          case 'remove': {
            text += node.text;
            break;
          }
          case 'update': {
            properties = { ...properties, ...data.properties };
            newProperties = { ...newProperties, ...data.newProperties };
            newText += node.text;
            break;
          }
        }
      });

      return;
    }

    if (!ElementApi.isElement(node)) return;

    const suggestionData = getSuggestionData(node);

    if (suggestionData?.id !== keyId2SuggestionId(id)) return;

    const inlineSuggestionText = getInlineSuggestionElementText(node);

    if (inlineSuggestionText) {
      if (suggestionData.type === 'insert') {
        newText += inlineSuggestionText;
      } else if (suggestionData.type === 'remove') {
        text += inlineSuggestionText;
      } else if (suggestionData.type === 'update') {
        properties = { ...properties, ...suggestionData.properties };
        newProperties = {
          ...newProperties,
          ...suggestionData.newProperties,
        };
        newText += inlineSuggestionText;
      }

      return;
    }

    if (!isBlockSuggestion(node)) return;

    const nextText = suggestionData.isLineBreak
      ? BLOCK_SUGGESTION_TOKEN
      : `${BLOCK_SUGGESTION_TOKEN}${suggestionTypeText(node)}`;

    if (suggestionData.type === 'insert') {
      newText += nextText;
    } else if (suggestionData.type === 'remove') {
      text += nextText;
    }
  });

  const suggestionData = getSuggestionData(sortedEntries[0]![0]);

  if (!suggestionData) return null;

  const keyId = getSuggestionKey(id);
  const comments = discussionsById.get(id)?.comments ?? EMPTY_COMMENTS;
  const createdAt = new Date(suggestionData.createdAt);
  const suggestionId = keyId2SuggestionId(id);

  if (suggestionData.type === 'update') {
    return {
      comments,
      createdAt,
      keyId,
      newProperties,
      newText,
      properties,
      suggestionId,
      type: 'update',
      userId: suggestionData.userId,
    };
  }

  if (newText.length > 0 && text.length > 0) {
    return {
      comments,
      createdAt,
      keyId,
      newText,
      suggestionId,
      text,
      type: 'replace',
      userId: suggestionData.userId,
    };
  }

  if (newText.length > 0) {
    return {
      comments,
      createdAt,
      keyId,
      newText,
      suggestionId,
      type: 'insert',
      userId: suggestionData.userId,
    };
  }

  if (text.length > 0) {
    return {
      comments,
      createdAt,
      keyId,
      suggestionId,
      text,
      type: 'remove',
      userId: suggestionData.userId,
    };
  }

  return null;
};

export const buildBlockDiscussionIndex = ({
  discussions,
  entries,
  getCommentId,
  getSuggestionData,
  getSuggestionDataList,
  getSuggestionId,
  isBlockSuggestion,
}: BuildBlockDiscussionIndexOptions): BlockDiscussionIndex => {
  const commentOwnerById = new Map<string, Path>();
  const suggestionOwnerById = new Map<string, Path>();
  const commentIds = new Set<string>();
  const suggestionEntriesById = new Map<string, SuggestionEntry[]>();
  const discussionsById = new Map(
    discussions.map((discussion) => [discussion.id, discussion])
  );

  entries.forEach(([node, path]) => {
    const blockPath = getTopLevelPath(path);

    if (!blockPath) return;

    if (TextApi.isText(node)) {
      const commentId = getCommentId(node);

      if (commentId) {
        commentIds.add(commentId);

        if (!commentOwnerById.has(commentId)) {
          commentOwnerById.set(commentId, blockPath);
        }
      }
    }

    getSuggestionIds(node, getSuggestionDataList, getSuggestionId).forEach(
      (suggestionId) => {
        if (!suggestionOwnerById.has(suggestionId)) {
          suggestionOwnerById.set(suggestionId, blockPath);
        }

        appendByKey(suggestionEntriesById, suggestionId, [
          node as TElement | TSuggestionText,
          path,
        ]);
      }
    );
  });

  const discussionsByBlock = new Map<string, TDiscussion[]>();

  discussions.forEach((discussion) => {
    const ownerPath = commentOwnerById.get(discussion.id);

    if (!ownerPath || !commentIds.has(discussion.id) || discussion.isResolved) {
      return;
    }

    appendByKey(discussionsByBlock, getBlockKey(ownerPath), {
      ...discussion,
      createdAt: new Date(discussion.createdAt),
    });
  });

  const suggestionsByBlock = new Map<string, ResolvedSuggestion[]>();

  suggestionEntriesById.forEach((suggestionEntries, suggestionId) => {
    const ownerPath = suggestionOwnerById.get(suggestionId);

    if (!ownerPath) return;

    const resolvedSuggestion = toResolvedSuggestion({
      discussionsById,
      entries: suggestionEntries,
      getSuggestionData,
      getSuggestionDataList,
      id: suggestionId,
      isBlockSuggestion,
    });

    if (!resolvedSuggestion) return;

    appendByKey(suggestionsByBlock, getBlockKey(ownerPath), resolvedSuggestion);
  });

  return {
    commentIds,
    discussionsByBlock,
    suggestionsByBlock,
  };
};

const buildEditorDiscussionIndex = (
  editor: PlateEditor,
  discussions: TDiscussion[]
) => {
  const commentApi = editor.getApi(CommentPlugin).comment;
  const suggestionApi = editor.getApi(SuggestionPlugin).suggestion;

  return buildBlockDiscussionIndex({
    discussions,
    entries: [...editor.api.nodes({ at: [], mode: 'all' })],
    getCommentId: (node) => commentApi.nodeId(node),
    getSuggestionData: (node) => suggestionApi.suggestionData(node),
    getSuggestionDataList: (node) => suggestionApi.dataList(node),
    getSuggestionId: (node) => suggestionApi.nodeId(node),
    isBlockSuggestion: (node) =>
      ElementApi.isElement(node) && suggestionApi.isBlockSuggestion(node),
  });
};

const areDiscussionsEqual = (
  left: TDiscussion[],
  right: TDiscussion[]
) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index];

    return (
      other !== undefined &&
      item.id === other.id &&
      item.updatedAt === other.updatedAt &&
      item.isResolved === other.isResolved &&
      item.comments === other.comments
    );
  });

const areSuggestionPropertiesEqual = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);

  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
  );
};

const areSuggestionsEqual = (
  left: ResolvedSuggestion[],
  right: ResolvedSuggestion[]
) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index];

    return (
      other !== undefined &&
      item.suggestionId === other.suggestionId &&
      item.keyId === other.keyId &&
      item.type === other.type &&
      item.userId === other.userId &&
      item.createdAt.getTime() === other.createdAt.getTime() &&
      ('text' in item ? item.text : undefined) ===
        ('text' in other ? other.text : undefined) &&
      ('newText' in item ? item.newText : undefined) ===
        ('newText' in other ? other.newText : undefined) &&
      areSuggestionPropertiesEqual(
        item.properties,
        other.properties
      ) &&
      areSuggestionPropertiesEqual(
        item.newProperties,
        other.newProperties
      ) &&
      item.comments === other.comments
    );
  });

const areBlockDiscussionItemsEqual = (
  left: BlockDiscussionItems,
  right: BlockDiscussionItems
) =>
  areDiscussionsEqual(
    left.resolvedDiscussions,
    right.resolvedDiscussions
  ) &&
  areSuggestionsEqual(left.resolvedSuggestions, right.resolvedSuggestions);

export class BlockDiscussionIndexStore {
  private blockItems = new Map<string, BlockDiscussionItems>();
  private blockListeners = new Map<string, Set<() => void>>();
  private commentIdListeners = new Set<() => void>();
  private commentIds: readonly string[] = EMPTY_COMMENT_IDS;
  private presenceListeners = new Set<() => void>();

  initialized = false;
  lastDiscussions: TDiscussion[] | null = null;

  get empty() {
    return this.blockItems.size === 0 && this.commentIds.length === 0;
  }

  getBlockItems = (blockKey: string) =>
    this.blockItems.get(blockKey) ?? EMPTY_BLOCK_DISCUSSION_ITEMS;

  getCommentIds = () => this.commentIds;

  getPresent = () => !this.empty;

  subscribeBlock = (blockKey: string, listener: () => void) => {
    const listeners = this.blockListeners.get(blockKey) ?? new Set();

    listeners.add(listener);
    this.blockListeners.set(blockKey, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.blockListeners.delete(blockKey);
    };
  };

  subscribeCommentIds = (listener: () => void) => {
    this.commentIdListeners.add(listener);

    return () => {
      this.commentIdListeners.delete(listener);
    };
  };

  subscribePresence = (listener: () => void) => {
    this.presenceListeners.add(listener);

    return () => {
      this.presenceListeners.delete(listener);
    };
  };

  update(index: BlockDiscussionIndex, discussions: TDiscussion[]) {
    const wasPresent = this.getPresent();
    const previousBlockItems = this.blockItems;
    const nextBlockItems = new Map<string, BlockDiscussionItems>();
    const nextKeys = new Set([
      ...index.discussionsByBlock.keys(),
      ...index.suggestionsByBlock.keys(),
    ]);

    nextKeys.forEach((blockKey) => {
      const nextItems: BlockDiscussionItems = {
        resolvedDiscussions:
          index.discussionsByBlock.get(blockKey) ?? EMPTY_DISCUSSIONS,
        resolvedSuggestions:
          index.suggestionsByBlock.get(blockKey) ?? EMPTY_SUGGESTIONS,
      };
      const previousItems = previousBlockItems.get(blockKey);

      nextBlockItems.set(
        blockKey,
        previousItems && areBlockDiscussionItemsEqual(previousItems, nextItems)
          ? previousItems
          : nextItems
      );
    });

    const changedBlockKeys = new Set([
      ...previousBlockItems.keys(),
      ...nextBlockItems.keys(),
    ]);

    this.blockItems = nextBlockItems;
    this.initialized = true;
    this.lastDiscussions = discussions;

    changedBlockKeys.forEach((blockKey) => {
      const previousItems =
        previousBlockItems.get(blockKey) ?? EMPTY_BLOCK_DISCUSSION_ITEMS;
      const nextItems = nextBlockItems.get(blockKey) ?? EMPTY_BLOCK_DISCUSSION_ITEMS;

      if (previousItems === nextItems) return;
      this.blockListeners.get(blockKey)?.forEach((listener) => listener());
    });

    const nextCommentIds = [...index.commentIds].sort();
    const commentIdsChanged =
      this.commentIds.length !== nextCommentIds.length ||
      this.commentIds.some((id, index) => id !== nextCommentIds[index]);

    if (commentIdsChanged) {
      this.commentIds = nextCommentIds;
      this.commentIdListeners.forEach((listener) => listener());
    }

    if (wasPresent !== this.getPresent()) {
      this.presenceListeners.forEach((listener) => listener());
    }
  }
}

const discussionIndexStores = new WeakMap<
  PlateEditor,
  BlockDiscussionIndexStore
>();

export const getBlockDiscussionIndexStore = (editor: PlateEditor) => {
  const existing = discussionIndexStores.get(editor);

  if (existing) return existing;

  const store = new BlockDiscussionIndexStore();
  discussionIndexStores.set(editor, store);

  return store;
};

type EditorOperation = PlateEditor['operations'][number];

const operationHasDiscussionData = (
  editor: PlateEditor,
  operation: EditorOperation
) => {
  const commentApi = editor.getApi(CommentPlugin).comment;
  const suggestionApi = editor.getApi(SuggestionPlugin).suggestion;
  const nodeHasDiscussionData = (node: TNode): boolean => {
    if (TextApi.isText(node)) {
      return Boolean(
        commentApi.nodeId(node as TCommentText) ||
          suggestionApi.nodeId(node as TSuggestionText) ||
          suggestionApi.dataList(node as TSuggestionText).length > 0
      );
    }

    return (
      suggestionApi.isBlockSuggestion(node) ||
      node.children.some(nodeHasDiscussionData)
    );
  };

  if (operation.type === 'insert_node') {
    return nodeHasDiscussionData(operation.node);
  }

  if (
    operation.type === 'set_selection' ||
    operation.type === 'split_node' ||
    operation.type === 'merge_node' ||
    operation.type === 'move_node' ||
    operation.type === 'remove_node'
  ) {
    return false;
  }

  if (
    operation.type !== 'insert_text' &&
    operation.type !== 'remove_text' &&
    operation.type !== 'set_node'
  ) {
    return true;
  }

  const node = NodeApi.getIf(editor, operation.path);

  return node ? nodeHasDiscussionData(node) : true;
};

export const canReuseEmptyDiscussionIndex = ({
  discussionsChanged,
  discussionsEmpty,
  indexEmpty,
  initialized,
  operations,
  operationHasData,
}: {
  discussionsChanged: boolean;
  discussionsEmpty: boolean;
  indexEmpty: boolean;
  initialized: boolean;
  operations: Array<{ type: string }>;
  operationHasData: (operation: Array<{ type: string }>[number]) => boolean;
}) =>
  initialized &&
  indexEmpty &&
  discussionsEmpty &&
  !discussionsChanged &&
  operations.length > 0 &&
  operations.every(
    (operation) =>
      operation.type === 'set_selection' ||
      operation.type === 'split_node' ||
      operation.type === 'merge_node' ||
      operation.type === 'move_node' ||
      operation.type === 'remove_node' ||
      ((operation.type === 'insert_node' ||
        operation.type === 'insert_text' ||
        operation.type === 'remove_text' ||
        operation.type === 'set_node') &&
        !operationHasData(operation))
  );

export const refreshBlockDiscussionIndex = (
  editor: PlateEditor,
  discussions: TDiscussion[],
  operations: EditorOperation[] = []
) => {
  const store = getBlockDiscussionIndexStore(editor);
  const discussionsChanged = store.lastDiscussions !== discussions;

  if (
    canReuseEmptyDiscussionIndex({
      discussionsChanged,
      discussionsEmpty: discussions.length === 0,
      indexEmpty: store.empty,
      initialized: store.initialized,
      operations,
      operationHasData: (operation) =>
        operationHasDiscussionData(editor, operation as EditorOperation),
    })
  ) {
    return;
  }

  store.update(buildEditorDiscussionIndex(editor, discussions), discussions);
};

export const usePresentCommentIds = () => {
  const editor = useEditorRef();
  const store = getBlockDiscussionIndexStore(editor);

  return React.useSyncExternalStore(
    store.subscribeCommentIds,
    store.getCommentIds,
    store.getCommentIds
  );
};

export const useDiscussionIndexPresent = () => {
  const editor = useEditorRef();
  const store = getBlockDiscussionIndexStore(editor);

  return React.useSyncExternalStore(
    store.subscribePresence,
    store.getPresent,
    store.getPresent
  );
};

export const useBlockDiscussionItems = (blockPath: Path) => {
  const editor = useEditorRef();
  const store = getBlockDiscussionIndexStore(editor);
  const blockKey = getBlockKey(blockPath);
  const subscribe = React.useCallback(
    (listener: () => void) => store.subscribeBlock(blockKey, listener),
    [blockKey, store]
  );
  const getSnapshot = React.useCallback(
    () => store.getBlockItems(blockKey),
    [blockKey, store]
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
