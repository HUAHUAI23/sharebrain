import type { Value } from 'platejs';

import type { TDiscussion } from '../kits/discussion-kit';
import type { TComment } from '../ui/comment';

export type TDiscussionReadState = {
  activityKey: string;
  discussionId: string;
  readAt: Date | string;
};

export type DiscussionReadItem = {
  activityKey: string;
  discussionId: string;
};

export type DiscussionAction =
  | { discussion: TDiscussion; type: 'createThread' }
  | { comment: TComment; discussionId: string; type: 'addComment' }
  | {
      contentRich: Value;
      discussionId: string;
      commentId: string;
      updatedAt: string;
      type: 'updateComment';
    }
  | { discussionId: string; commentId: string; type: 'deleteComment' }
  | { discussionId: string; updatedAt: string; type: 'resolveThread' }
  | { discussionId: string; type: 'deleteThread' };

export const nowIso = () => new Date().toISOString();

const byCreatedAt = <T extends { createdAt: Date | string }>(left: T, right: T) =>
  new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

const fnv1a = (input: string) => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

export function getDiscussionExternalActivityKey(
  discussion: TDiscussion,
  currentUserId: string
) {
  const payload = discussion.comments
    .filter((comment) => comment.userId !== currentUserId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((comment) => [
      comment.id,
      comment.userId,
      comment.createdAt,
      comment.updatedAt,
      comment.isEdited,
    ]);

  if (payload.length === 0) return '';

  return `v1:${payload.length}:${fnv1a(JSON.stringify(payload))}`;
}

export function isDiscussionUnread({
  currentUserId,
  discussion,
  readState,
}: {
  currentUserId: string;
  discussion: TDiscussion;
  readState?: TDiscussionReadState | undefined;
}) {
  const activityKey = getDiscussionExternalActivityKey(discussion, currentUserId);

  return activityKey.length > 0 && readState?.activityKey !== activityKey;
}

export function getDiscussionReadItem(
  discussion: TDiscussion,
  currentUserId: string
): DiscussionReadItem | null {
  const activityKey = getDiscussionExternalActivityKey(discussion, currentUserId);

  if (!activityKey) return null;

  return {
    activityKey,
    discussionId: discussion.id,
  };
}

export function mergeDiscussionReadStates(
  readStates: TDiscussionReadState[],
  items: DiscussionReadItem[],
  readAt = nowIso()
) {
  const nextStates = new Map(readStates.map((state) => [state.discussionId, state]));

  items.forEach((item) => {
    nextStates.set(item.discussionId, {
      ...item,
      readAt,
    });
  });

  return [...nextStates.values()];
}

export function applyDiscussionAction(
  discussions: TDiscussion[],
  action: DiscussionAction
): TDiscussion[] {
  switch (action.type) {
    case 'createThread': {
      return [...discussions.filter((discussion) => discussion.id !== action.discussion.id), action.discussion].sort(
        byCreatedAt
      );
    }
    case 'addComment': {
      return discussions.map((discussion) => {
        if (discussion.id !== action.discussionId) return discussion;

        return {
          ...discussion,
          comments: [
            ...discussion.comments.filter((comment) => comment.id !== action.comment.id),
            action.comment,
          ].sort(byCreatedAt),
          updatedAt: action.comment.updatedAt,
        };
      });
    }
    case 'updateComment': {
      return discussions.map((discussion) => {
        if (discussion.id !== action.discussionId) return discussion;

        return {
          ...discussion,
          comments: discussion.comments.map((comment) =>
            comment.id === action.commentId
              ? {
                  ...comment,
                  contentRich: action.contentRich,
                  isEdited: true,
                  updatedAt: action.updatedAt,
                }
              : comment
          ),
          updatedAt: action.updatedAt,
        };
      });
    }
    case 'deleteComment': {
      return discussions
        .map((discussion) => {
          if (discussion.id !== action.discussionId) return discussion;

          return {
            ...discussion,
            comments: discussion.comments.filter(
              (comment) => comment.id !== action.commentId
            ),
            updatedAt: nowIso(),
          };
        })
        .filter((discussion) => discussion.comments.length > 0);
    }
    case 'resolveThread': {
      return discussions.map((discussion) =>
        discussion.id === action.discussionId
          ? { ...discussion, isResolved: true, updatedAt: action.updatedAt }
          : discussion
      );
    }
    case 'deleteThread': {
      return discussions.filter((discussion) => discussion.id !== action.discussionId);
    }
  }
}
