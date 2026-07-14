import * as React from 'react';

import { CommentPlugin } from '@platejs/comment/react';
import {
  CheckCheckIcon,
  Link2OffIcon,
  MessageSquareTextIcon,
  SearchIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import type { NodeEntry, TCommentText, Value } from 'platejs';
import { NodeApi } from 'platejs';
import { useEditorRef, useEditorVersion, usePluginOption } from 'platejs/react';

import { Button } from '@sharebrain/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@sharebrain/ui/components/popover';
import { cn } from '@sharebrain/ui/lib/utils';
import { UserAvatar } from '@sharebrain/ui/components/user-avatar';

import { commentPlugin } from '../kits/comment-kit';
import {
  type TDiscussion,
  discussionPlugin,
  markEditorDiscussionRead,
  setEditorDiscussionReadStates,
} from '../kits/discussion-kit';
import {
  getDiscussionReadItem,
  isDiscussionUnread,
  mergeDiscussionReadStates,
} from '../lib/discussions';
import { formatCommentDate } from './comment';

const richToText = (value: Value) =>
  value.map((node) => NodeApi.string(node)).join('\n');

/**
 * 标题栏入口：点击弹出评论总览卡片（hover-card 视觉、无遮罩），
 * 顶部支持按评论内容/原文/作者搜索；点击条目滚动定位到被评论文本
 * 并激活对应评论卡片。
 */
export function CommentsPopoverButton() {
  const editor = useEditorRef();
  const discussions = usePluginOption(discussionPlugin, 'discussions');
  const readStates = usePluginOption(discussionPlugin, 'readStates');
  const currentUserId = usePluginOption(discussionPlugin, 'currentUserId');
  const version = useEditorVersion() ?? 0;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  // 只统计仍在文档中且未解决的讨论（评论文本可能已被删除）。
  const activeDiscussions = React.useMemo(() => {
    const presentIds = new Set<string>();

    for (const [node] of editor
      .getApi(CommentPlugin)
      .comment.nodes({ at: [] }) as NodeEntry<TCommentText>[]) {
      const id = editor.getApi(CommentPlugin).comment.nodeId(node);

      if (id) presentIds.add(id);
    }

    return discussions
      .filter(
        (discussion) =>
          !discussion.isResolved &&
          (presentIds.has(discussion.id) || Boolean(discussion.detachedAt))
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [discussions, editor, version]);

  const readStatesByDiscussionId = React.useMemo(
    () => new Map(readStates.map((state) => [state.discussionId, state])),
    [readStates]
  );

  const unreadDiscussions = React.useMemo(
    () =>
      activeDiscussions.filter((discussion) =>
        isDiscussionUnread({
          currentUserId,
          discussion,
          readState: readStatesByDiscussionId.get(discussion.id),
        })
      ),
    [activeDiscussions, currentUserId, readStatesByDiscussionId]
  );

  const unreadCount = unreadDiscussions.length;

  const filteredDiscussions = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) return activeDiscussions;

    const users = editor.getOptions(discussionPlugin).users;

    return activeDiscussions.filter((discussion) => {
      const haystack = [
        discussion.documentContent ?? '',
        ...discussion.comments.flatMap((comment) => [
          richToText(comment.contentRich),
          users[comment.userId]?.name ?? '',
        ]),
      ]
        .join('\n')
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [activeDiscussions, editor, query]);

  const jumpToDiscussion = React.useCallback(
    (discussion: TDiscussion) => {
      if (discussion.detachedAt) {
        markEditorDiscussionRead(editor, discussion);
        return;
      }
      const entries = editor
        .getApi(CommentPlugin)
        .comment.nodes({ at: [] }) as NodeEntry<TCommentText>[];
      const entry = entries.find(
        ([node]) =>
          editor.getApi(CommentPlugin).comment.nodeId(node) === discussion.id
      );

      if (!entry) return;

      markEditorDiscussionRead(editor, discussion);
      setOpen(false);

      // 等卡片关闭后再滚动定位并激活评论卡片。
      setTimeout(() => {
        const domNode = editor.api.toDOMNode(entry[0]);

        domNode?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        editor.setOption(commentPlugin, 'activeId', discussion.id);
        editor.setOption(commentPlugin, 'hoverId', discussion.id);

        setTimeout(() => {
          editor.setOption(commentPlugin, 'hoverId', null);
        }, 1500);
      }, 150);
    },
    [editor]
  );

  const markAllRead = React.useCallback(() => {
    const items = unreadDiscussions
      .map((discussion) => getDiscussionReadItem(discussion, currentUserId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (items.length === 0) return;

    const nextReadStates = mergeDiscussionReadStates(readStates, items);

    setEditorDiscussionReadStates(editor, nextReadStates);
    editor.getOption(discussionPlugin, 'onDiscussionRead')?.(items);
  }, [currentUserId, editor, readStates, unreadDiscussions]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={m.editor_comments_open()}
        >
          <MessageSquareTextIcon size={16} />
          {unreadCount > 0 && (
            <span className="-top-0.5 -right-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-none">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="flex max-h-[min(70dvh,560px)] w-[380px] flex-col overflow-hidden p-0"
        align="end"
        sideOffset={6}
      >
        <div className="grid gap-2 border-b px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold text-sm">
              {m.editor_comments_panel_title()}
            </span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                {m.editor_comments_unread_count({ count: String(unreadCount) })}
              </span>
            )}
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                className="ml-auto h-7 gap-1 px-2 text-muted-foreground text-xs"
                onClick={markAllRead}
                type="button"
              >
                <CheckCheckIcon className="size-3.5" />
                {m.editor_comments_mark_all_read()}
              </Button>
            )}
          </div>
          <div className="relative">
            <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
            <input
              className={cn(
                'h-7 w-full rounded-md border-none bg-muted pr-2 pl-7 text-sm outline-none',
                'placeholder:text-muted-foreground/70'
              )}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={m.editor_comments_search_placeholder()}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredDiscussions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-muted-foreground text-sm">
              <MessageSquareTextIcon className="size-6 opacity-60" />
              {activeDiscussions.length === 0
                ? m.editor_comments_empty()
                : m.editor_no_results()}
            </div>
          ) : (
            filteredDiscussions.map((discussion) => (
              <DiscussionListItem
                key={discussion.id}
                discussion={discussion}
                unread={isDiscussionUnread({
                  currentUserId,
                  discussion,
                  readState: readStatesByDiscussionId.get(discussion.id),
                })}
                onJump={() => jumpToDiscussion(discussion)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DiscussionListItem({
  discussion,
  unread,
  onJump,
}: {
  discussion: TDiscussion;
  unread: boolean;
  onJump: () => void;
}) {
  const editor = useEditorRef();
  const firstComment = discussion.comments[0];
  const replies = discussion.comments.length - 1;
  const userInfo = editor.getOptions(discussionPlugin).users[
    firstComment?.userId ?? discussion.userId
  ];

  return (
    <button
      type="button"
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 border-b px-4 py-3 text-left outline-none transition-colors last:border-b-0',
        'hover:bg-accent/60 focus-visible:bg-accent/60',
        unread && 'bg-accent/35'
      )}
      onClick={onJump}
    >
      <div className="flex items-center gap-2">
        <UserAvatar
          size="sm"
          name={userInfo?.name ?? ''}
          fallbackKey={userInfo?.id ?? discussion.userId}
          src={userInfo?.avatarUrl}
        />
        {unread && <span className="size-1.5 rounded-full bg-primary" />}
        <span className={cn('text-sm', unread ? 'font-semibold' : 'font-medium')}>
          {userInfo?.name}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatCommentDate(new Date(discussion.createdAt))}
        </span>
      </div>

      {discussion.documentContent && (
        <div className="truncate border-highlight border-l-2 pl-2 text-muted-foreground text-xs">
          {discussion.documentContent}
        </div>
      )}

      {discussion.detachedAt && (
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <Link2OffIcon className="size-3.5" />
          {m.editor_comment_detached()}
        </div>
      )}

      {firstComment && (
        <div className={cn('line-clamp-2 text-sm', unread && 'font-medium')}>
          {richToText(firstComment.contentRich)}
        </div>
      )}

      {replies > 0 && (
        <div className="text-muted-foreground text-xs">
          {m.editor_comments_replies({ count: String(replies) })}
        </div>
      )}
    </button>
  );
}
