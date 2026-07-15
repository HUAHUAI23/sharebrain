// 在顶层正文块挂载评论和建议交互，嵌套节点不创建额外订阅。
import * as React from 'react';

import type { PlateElementProps, RenderNodeWrapper } from 'platejs/react';

import { getDraftCommentKey } from '@platejs/comment';
import { CommentPlugin } from '@platejs/comment/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PencilLineIcon,
} from 'lucide-react';
import { type AnyPluginConfig, type NodeEntry, PathApi } from 'platejs';
import { useEditorRef, usePluginOption } from 'platejs/react';
import { m } from '@sharebrain/i18n';

import { Button } from '@sharebrain/ui/components/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@sharebrain/ui/components/popover';
import { commentPlugin } from '../kits/comment-kit';
import {
  discussionPlugin,
  markEditorDiscussionRead,
  type TDiscussion,
} from '../kits/discussion-kit';
import {
  useBlockDiscussionItems,
  useDiscussionIndexPresent,
} from '../lib/block-discussion-index';
import { suggestionPlugin } from '../kits/suggestion-kit';

import { BlockSuggestionCard, isResolvedSuggestion } from './block-suggestion';
import { Comment, CommentCreateForm } from './comment';

const BlockDiscussionPresenceContext = React.createContext(false);

export function BlockDiscussionPresence({
  children,
}: {
  children: React.ReactNode;
}) {
  const indexPresent = useDiscussionIndexPresent();
  const discussions = usePluginOption(discussionPlugin, 'discussions');
  const commentingBlock = usePluginOption(commentPlugin, 'commentingBlock');
  const activeCommentId = usePluginOption(commentPlugin, 'activeId');
  const activeSuggestionId = usePluginOption(suggestionPlugin, 'activeId');
  const enabled = Boolean(
    indexPresent ||
      discussions.length > 0 ||
      commentingBlock ||
      activeCommentId ||
      activeSuggestionId
  );

  return (
    <BlockDiscussionPresenceContext.Provider value={enabled}>
      {children}
    </BlockDiscussionPresenceContext.Provider>
  );
}

export const BlockDiscussion: RenderNodeWrapper<AnyPluginConfig> = (props) => {
  const enabled = React.useContext(BlockDiscussionPresenceContext);

  if (!enabled || props.path.length !== 1) return;

  return (blockProps) => <BlockCommentContent {...blockProps} />;
};

const getCreatedAtTime = (value: Date | string) => new Date(value).getTime();

const BlockCommentContent = ({ children, element }: PlateElementProps) => {
  const editor = useEditorRef();
  const commentsApi = editor.getApi(CommentPlugin).comment;
  const blockPath = editor.api.findPath(element) ?? [];
  const isTopLevelBlock = blockPath.length === 1;
  const draftCommentNode = isTopLevelBlock
    ? commentsApi.node({ at: blockPath, isDraft: true })
    : undefined;
  const { resolvedDiscussions, resolvedSuggestions } =
    useBlockDiscussionItems(blockPath);

  const suggestionsCount = resolvedSuggestions.length;
  const discussionsCount = resolvedDiscussions.length;
  const totalCount = suggestionsCount + discussionsCount;

  const activeSuggestionId = usePluginOption(suggestionPlugin, 'activeId');
  const activeSuggestion =
    activeSuggestionId &&
    resolvedSuggestions.find((s) => s.suggestionId === activeSuggestionId);

  const commentingBlock = usePluginOption(commentPlugin, 'commentingBlock');
  const activeCommentId = usePluginOption(commentPlugin, 'activeId');
  const isCommenting = activeCommentId === getDraftCommentKey();
  const activeDiscussion =
    activeCommentId &&
    resolvedDiscussions.find((d) => d.id === activeCommentId);

  const noneActive = !activeSuggestion && !activeDiscussion;

  const sortedMergedData = [
    ...resolvedDiscussions,
    ...resolvedSuggestions,
  ].sort((a, b) => getCreatedAtTime(a.createdAt) - getCreatedAtTime(b.createdAt));

  const selected =
    resolvedDiscussions.some((d) => d.id === activeCommentId) ||
    resolvedSuggestions.some((s) => s.suggestionId === activeSuggestionId);

  const [_open, setOpen] = React.useState(selected);

  // in some cases, we may comment the multiple blocks
  const commentingCurrent =
    !!commentingBlock && PathApi.equals(blockPath, commentingBlock);

  const open =
    _open ||
    selected ||
    (isCommenting && !!draftCommentNode && commentingCurrent);

  // 锚点必须在 DOM 提交后解析：评论草稿刚设置时 render 阶段还查不到
  // 对应 leaf 的 DOM，同步计算会得到空锚点，弹层会掉到视口左上角。
  const [anchorElement, setAnchorElement] = React.useState<HTMLElement | null>(
    null
  );

  React.useLayoutEffect(() => {
    if (!open) {
      setAnchorElement(null);
      return;
    }

    const at = editor.api.findPath(element) ?? [];
    let activeNode: NodeEntry | undefined;

    if (activeSuggestion) {
      activeNode = [
        ...editor.getApi(SuggestionPlugin).suggestion.nodes({ at }),
      ].find(
        ([node]) =>
          editor.getApi(SuggestionPlugin).suggestion.nodeId(node) ===
          activeSuggestion.suggestionId
      );
    }

    if (activeCommentId) {
      if (activeCommentId === getDraftCommentKey()) {
        activeNode = editor
          .getApi(CommentPlugin)
          .comment.node({ at, isDraft: true });
      } else {
        activeNode = [
          ...editor.getApi(CommentPlugin).comment.nodes({ at }),
        ].find(
          ([node]) =>
            editor.getApi(commentPlugin).comment.nodeId(node) ===
            activeCommentId
        );
      }
    }

    let dom: HTMLElement | null = null;

    try {
      if (activeNode) {
        dom = editor.api.toDOMNode(activeNode[0]) ?? null;
      }

      if (!dom) {
        // 找不到具体评论文本时退回整个块，保证弹层始终贴着内容。
        dom = editor.api.toDOMNode(element) ?? null;
      }
    } catch {
      dom = null;
    }

    setAnchorElement(dom);
  }, [open, activeSuggestion, activeCommentId, editor, element]);

  if (!isTopLevelBlock) return <>{children}</>;

  if (suggestionsCount + resolvedDiscussions.length === 0 && !draftCommentNode)
    return <div className="w-full">{children}</div>;

  return (
    <div className="flex w-full justify-between">
      <Popover
        open={open}
        onOpenChange={(_open_) => {
          if (!_open_ && isCommenting && draftCommentNode) {
            editor.tf.unsetNodes(getDraftCommentKey(), {
              at: [],
              mode: 'lowest',
              match: (n) => n[getDraftCommentKey()],
            });
          }
          setOpen(_open_);
        }}
      >
        <div className="w-full">{children}</div>
        {anchorElement && (
          <PopoverAnchor
            asChild
            className="w-full"
            virtualRef={{ current: anchorElement }}
          />
        )}

        <PopoverContent
          className="max-h-[min(50dvh,calc(-24px+var(--radix-popper-available-height)))] w-[380px] min-w-[130px] max-w-[calc(100vw-24px)] overflow-y-auto p-0 data-[state=closed]:opacity-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // 贴着被评论文本下方、与文本起始对齐（Notion 式），避免居中
          // 定位随锚点宽度变化而左右乱跳。
          align="start"
          collisionPadding={12}
          side="bottom"
          sideOffset={6}
        >
          {isCommenting ? (
            <CommentCreateForm className="p-4" focusOnMount />
          ) : noneActive ? (
            sortedMergedData.map((item, index) =>
              isResolvedSuggestion(item) ? (
                <BlockSuggestionCard
                  key={item.suggestionId}
                  idx={index}
                  isLast={index === sortedMergedData.length - 1}
                  suggestion={item}
                />
              ) : (
                <BlockComment
                  key={item.id}
                  discussion={item}
                  isLast={index === sortedMergedData.length - 1}
                />
              )
            )
          ) : (
            <>
              {activeSuggestion && (
                <BlockSuggestionCard
                  key={activeSuggestion.suggestionId}
                  idx={0}
                  isLast={true}
                  suggestion={activeSuggestion}
                />
              )}

              {activeDiscussion && (
                <BlockComment discussion={activeDiscussion} isLast={true} />
              )}
            </>
          )}
        </PopoverContent>

        {totalCount > 0 && (
          <div className="relative left-0 size-0 select-none">
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="!px-1.5 mt-1 ml-1 flex h-6 gap-1 py-0 text-muted-foreground/80 hover:text-muted-foreground/80 data-[active=true]:bg-muted"
                aria-label={m.editor_comments_open()}
                data-active={open}
                contentEditable={false}
              >
                {suggestionsCount > 0 && discussionsCount === 0 && (
                  <PencilLineIcon className="size-4 shrink-0" />
                )}

                {suggestionsCount === 0 && discussionsCount > 0 && (
                  <MessageSquareTextIcon className="size-4 shrink-0" />
                )}

                {suggestionsCount > 0 && discussionsCount > 0 && (
                  <MessagesSquareIcon className="size-4 shrink-0" />
                )}

                <span className="font-semibold text-xs">{totalCount}</span>
              </Button>
            </PopoverTrigger>
          </div>
        )}
      </Popover>
    </div>
  );
};

function BlockComment({
  discussion,
  isLast,
}: {
  discussion: TDiscussion;
  isLast: boolean;
}) {
  const editor = useEditorRef();
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <React.Fragment key={discussion.id}>
      <div className="p-4">
        {discussion.comments.map((comment, index) => (
          <Comment
            key={comment.id ?? index}
            comment={comment}
            discussion={discussion}
            discussionLength={discussion.comments.length}
            documentContent={discussion?.documentContent}
            editingId={editingId}
            index={index}
            onEditorClick={() => markEditorDiscussionRead(editor, discussion)}
            setEditingId={setEditingId}
            showDocumentContent
          />
        ))}
        <CommentCreateForm discussionId={discussion.id} />
      </div>

      {!isLast && <div className="h-px w-full bg-muted" />}
    </React.Fragment>
  );
}
