import * as React from 'react';

import { CommentPlugin } from '@platejs/comment/react';
import { MessageSquareTextIcon, SearchIcon } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import type { NodeEntry, TCommentText, Value } from 'platejs';
import { NodeApi } from 'platejs';
import { useEditorRef, useEditorVersion, usePluginOption } from 'platejs/react';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@sharebrain/ui/components/avatar';
import { Button } from '@sharebrain/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@sharebrain/ui/components/popover';
import { cn } from '@sharebrain/ui/lib/utils';

import { commentPlugin } from '../kits/comment-kit';
import { type TDiscussion, discussionPlugin } from '../kits/discussion-kit';
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
        (discussion) => !discussion.isResolved && presentIds.has(discussion.id)
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [discussions, editor, version]);

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
      const entries = editor
        .getApi(CommentPlugin)
        .comment.nodes({ at: [] }) as NodeEntry<TCommentText>[];
      const entry = entries.find(
        ([node]) =>
          editor.getApi(CommentPlugin).comment.nodeId(node) === discussion.id
      );

      if (!entry) return;

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
          {activeDiscussions.length > 0 && (
            <span className="-top-0.5 -right-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-none">
              {activeDiscussions.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="flex max-h-[min(70dvh,560px)] w-[380px] flex-col overflow-hidden p-0"
        align="end"
        sideOffset={6}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="font-semibold text-sm">
            {m.editor_comments_panel_title()}
          </span>
          <div className="relative ml-auto w-44">
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
  onJump,
}: {
  discussion: TDiscussion;
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
        'hover:bg-accent/60 focus-visible:bg-accent/60'
      )}
      onClick={onJump}
    >
      <div className="flex items-center gap-2">
        <Avatar className="size-5">
          <AvatarImage alt={userInfo?.name} src={userInfo?.avatarUrl} />
          <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
        </Avatar>
        <span className="font-medium text-sm">{userInfo?.name}</span>
        <span className="text-muted-foreground text-xs">
          {formatCommentDate(new Date(discussion.createdAt))}
        </span>
      </div>

      {discussion.documentContent && (
        <div className="truncate border-highlight border-l-2 pl-2 text-muted-foreground text-xs">
          {discussion.documentContent}
        </div>
      )}

      {firstComment && (
        <div className="line-clamp-2 text-sm">
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
