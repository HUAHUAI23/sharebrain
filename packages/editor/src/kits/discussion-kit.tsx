// 维护编辑器评论状态，并只在顶层正文块挂载评论交互外壳。
import type { TComment } from '../ui/comment';

import { createPlatePlugin } from 'platejs/react';
import type { PlateEditor } from 'platejs/react';

import {
  BlockDiscussion,
  BlockDiscussionPresence,
} from '../ui/block-discussion';
import {
  type DiscussionAction,
  type DiscussionReadItem,
  type TDiscussionReadState,
  applyDiscussionAction,
  getDiscussionReadItem,
  nowIso,
} from '../lib/discussions';
import { refreshBlockDiscussionIndex } from '../lib/block-discussion-index';

export type TDiscussion = {
  id: string;
  comments: TComment[];
  createdAt: Date | string;
  isResolved: boolean;
  updatedAt: Date | string;
  userId: string;
  documentContent?: string;
  detachedAt?: Date | string;
  detachedReason?: 'version_restore';
};

export type TDiscussionUser = {
  id: string;
  name: string;
  avatarUrl?: string;
  hue?: number;
};

export type DiscussionActionHandler = (
  action: DiscussionAction,
  discussions: TDiscussion[]
) => void;
export type DiscussionReadHandler = (items: DiscussionReadItem[]) => void;
export type CanDeleteDiscussionHandler = (input: {
  currentUserId: string;
  discussion: TDiscussion;
}) => boolean;

const BLOCK_SUGGESTION_SELECTOR = '[data-block-suggestion="true"]';

const getTargetElement = (target: EventTarget | null) => {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) return target.parentElement;

  return null;
};

export const getDiscussionClickTarget = ({
  selector,
  target,
}: {
  selector: string;
  target: EventTarget | null;
}) => {
  const element = getTargetElement(target);

  if (!element) return null;

  return element.closest(selector) as HTMLElement | null;
};

export const getDiscussionBlockClickTarget = ({
  selector = BLOCK_SUGGESTION_SELECTOR,
  target,
}: {
  selector?: string;
  target: EventTarget | null;
}) =>
  getDiscussionClickTarget({
    selector,
    target,
  });

const fallbackUser: TDiscussionUser = {
  id: 'anonymous',
  name: 'Anonymous',
};

/**
 * UI-only plugin storing discussion threads and user directory. The host app
 * configures `currentUserId` and `users` (and may sync `discussions` with its
 * own persistence layer); the editor package stays business-agnostic.
 */
export const discussionPlugin = createPlatePlugin({
  handlers: {
    onChange: ({ editor }) => {
      refreshBlockDiscussionIndex(
        editor,
        editor.getOption(discussionPlugin, 'discussions'),
        [...editor.operations]
      );
    },
  },
  key: 'discussion',
  options: {
    currentUserId: fallbackUser.id,
    canDeleteDiscussion: null as CanDeleteDiscussionHandler | null,
    discussions: [] as TDiscussion[],
    onDiscussionAction: null as DiscussionActionHandler | null,
    onDiscussionRead: null as DiscussionReadHandler | null,
    readStates: [] as TDiscussionReadState[],
    users: { [fallbackUser.id]: fallbackUser } as Record<string, TDiscussionUser>,
  },
})
  .configure({
    render: {
      aboveEditable: BlockDiscussionPresence,
      aboveNodes: BlockDiscussion,
    },
  })
  .extendSelectors(({ getOption }) => ({
    currentUser: () =>
      getOption('users')[getOption('currentUserId')] ?? fallbackUser,
    user: (id: string) => getOption('users')[id] ?? fallbackUser,
  }));

export function setEditorDiscussions(
  editor: PlateEditor,
  discussions: TDiscussion[]
) {
  editor.setOption(discussionPlugin, 'discussions', discussions);
  refreshBlockDiscussionIndex(editor, discussions);
}

export function setEditorDiscussionReadStates(
  editor: PlateEditor,
  readStates: TDiscussionReadState[]
) {
  editor.setOption(discussionPlugin, 'readStates', readStates);
}

export function canCurrentUserDeleteDiscussion(
  editor: PlateEditor,
  discussion: TDiscussion
) {
  const currentUserId = editor.getOption(discussionPlugin, 'currentUserId');
  const canDeleteDiscussion = editor.getOption(
    discussionPlugin,
    'canDeleteDiscussion'
  );

  return canDeleteDiscussion
    ? canDeleteDiscussion({ currentUserId, discussion })
    : discussion.userId === currentUserId;
}

export function dispatchEditorDiscussionAction(
  editor: PlateEditor,
  action: DiscussionAction
) {
  const nextDiscussions = applyDiscussionAction(
    editor.getOption(discussionPlugin, 'discussions'),
    action
  );

  setEditorDiscussions(editor, nextDiscussions);

  const onDiscussionAction = editor.getOption(
    discussionPlugin,
    'onDiscussionAction'
  );

  if (onDiscussionAction) {
    onDiscussionAction(action, nextDiscussions);
  }
}

export function markEditorDiscussionRead(
  editor: PlateEditor,
  discussion: TDiscussion
) {
  const currentUserId = editor.getOption(discussionPlugin, 'currentUserId');
  const readItem = getDiscussionReadItem(discussion, currentUserId);

  if (!readItem) return;

  const existingReadState = editor
    .getOption(discussionPlugin, 'readStates')
    .find((state) => state.discussionId === readItem.discussionId);

  if (existingReadState?.activityKey === readItem.activityKey) return;

  const readStates = [
    ...editor
      .getOption(discussionPlugin, 'readStates')
      .filter((state) => state.discussionId !== readItem.discussionId),
    {
      ...readItem,
      readAt: nowIso(),
    },
  ];

  setEditorDiscussionReadStates(editor, readStates);
  editor.getOption(discussionPlugin, 'onDiscussionRead')?.([readItem]);
}

export const DiscussionKit = [discussionPlugin];
