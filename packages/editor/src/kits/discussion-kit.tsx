import type { TComment } from '../ui/comment';

import { createPlatePlugin } from 'platejs/react';

import { BlockDiscussion } from '../ui/block-discussion';

export type TDiscussion = {
  id: string;
  comments: TComment[];
  createdAt: Date;
  isResolved: boolean;
  userId: string;
  documentContent?: string;
};

export type TDiscussionUser = {
  id: string;
  name: string;
  avatarUrl?: string;
  hue?: number;
};

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
  key: 'discussion',
  options: {
    currentUserId: fallbackUser.id,
    discussions: [] as TDiscussion[],
    users: { [fallbackUser.id]: fallbackUser } as Record<string, TDiscussionUser>,
  },
})
  .configure({
    render: { aboveNodes: BlockDiscussion },
  })
  .extendSelectors(({ getOption }) => ({
    currentUser: () =>
      getOption('users')[getOption('currentUserId')] ?? fallbackUser,
    user: (id: string) => getOption('users')[id] ?? fallbackUser,
  }));

export const DiscussionKit = [discussionPlugin];
