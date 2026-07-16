import { type Value, TrailingBlockPlugin } from 'platejs';
import { type TPlateEditor, useEditorRef } from 'platejs/react';

import { AIKit } from './kits/ai-kit';
import { AlignKit } from './kits/align-kit';
import { AutoformatKit } from './kits/autoformat-kit';
import { BasicBlocksKit } from './kits/basic-blocks-kit';
import { BasicMarksKit } from './kits/basic-marks-kit';
import { BlockMenuKit } from './kits/block-menu-kit';
import { BlockPlaceholderKit } from './kits/block-placeholder-kit';
import { CalloutKit } from './kits/callout-kit';
import { CodeBlockKit } from './kits/code-block-kit';
import { CommentKit } from './kits/comment-kit';
import { CursorOverlayKit } from './kits/cursor-overlay-kit';
import { DiscussionKit } from './kits/discussion-kit';
import { DndKit } from './kits/dnd-kit';
import { EmojiKit } from './kits/emoji-kit';
import { ExitBreakKit } from './kits/exit-break-kit';
import { FloatingToolbarKit } from './kits/floating-toolbar-kit';
import { FontKit } from './kits/font-kit';
import { LineHeightKit } from './kits/line-height-kit';
import { LinkKit } from './kits/link-kit';
import { ListKit } from './kits/list-kit';
import { MarkdownKit } from './kits/markdown-kit';
import { MathKit } from './kits/math-kit';
import { MediaKit } from './kits/media-kit';
import { MentionKit } from './kits/mention-kit';
import { BaseNodeIdKit } from './kits/node-id-base-kit';
import { SlashKit } from './kits/slash-kit';
import { SuggestionKit } from './kits/suggestion-kit';
import { TableKit } from './kits/table-kit';
import { TocKit } from './kits/toc-kit';
import { ToggleKit } from './kits/toggle-kit';

export const EditorKit = [
  ...BaseNodeIdKit,
  ...AIKit,
  ...BlockMenuKit,

  // Elements
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ToggleKit,
  ...TocKit,
  ...MediaKit,
  ...CalloutKit,
  ...MathKit,
  ...LinkKit,
  ...MentionKit,

  // Marks
  ...BasicMarksKit,
  ...FontKit,

  // Block Style
  ...ListKit,
  ...AlignKit,
  ...LineHeightKit,

  // Review
  ...DiscussionKit,
  ...CommentKit,
  ...SuggestionKit,

  // Editing
  ...SlashKit,
  ...AutoformatKit,
  ...CursorOverlayKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  TrailingBlockPlugin,

  // Parsers
  ...MarkdownKit,

  // UI
  ...BlockPlaceholderKit,
  ...FloatingToolbarKit,
];

export type SharebrainEditor = TPlateEditor<Value, (typeof EditorKit)[number]>;

export const useEditor = () => useEditorRef<SharebrainEditor>();
