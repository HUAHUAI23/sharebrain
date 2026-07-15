export { BaseEditorKit } from './editor-base-kit';
export {
  EDITOR_VERSION_DIFF_INPUT_BUDGET,
  EDITOR_VERSION_DIFF_RESULT_BUDGET,
  cloneEditorVersionValue,
  computeEditorVersionDiff,
  estimateEditorVersionValue,
  getEditorVersionDiffSegments,
  hasEditorVersionDiff,
  isEditorVersionDiffWithinBudget,
  isEditorVersionValueWithinBudget,
  type EditorVersionDiffSegment,
  type EditorVersionValueBudget,
} from './lib/version-history';
export { VersionDiffKit, VersionDiffPlugin } from './kits/version-diff-kit';
export {
  VersionDiff,
  VersionDiffPreview,
  type VersionDiffPreviewProps,
  type VersionDiffProps,
} from './ui/version-diff';
export { VersionDiffLegend, type VersionDiffLegendProps } from './ui/version-diff-legend';
export { VersionPreview, type VersionPreviewProps } from './ui/version-preview';
export {
  canCurrentUserDeleteDiscussion,
  dispatchEditorDiscussionAction,
  discussionPlugin,
  markEditorDiscussionRead,
  setEditorDiscussionReadStates,
  setEditorDiscussions,
  type TDiscussion,
  type TDiscussionUser,
} from './kits/discussion-kit';
export { EditorKit, useEditor, type SharebrainEditor } from './editor-kit';
export { DocxExportKit } from './kits/docx-export-kit';
export {
  EditorMentionProvider,
  type EditorMentionItem,
} from './lib/mentions';
export {
  applyDiscussionAction,
  getDiscussionExternalActivityKey,
  getDiscussionReadItem,
  isDiscussionUnread,
  mergeDiscussionReadStates,
  type DiscussionAction,
  type DiscussionReadItem,
  type TDiscussionReadState,
} from './lib/discussions';
export {
  EditorUploadProvider,
  type EditorUploadErrorHandler,
  type EditorUploadHandler,
  type EditorUploadProgress,
  type UploadedEditorFile,
} from './lib/uploads';
export { CommentsPopoverButton } from './ui/comments-popover';
export { Editor, EditorContainer, EditorView } from './ui/editor';
export {
  EditorFixedToolbarPanel,
  type EditorFixedToolbarPanelProps,
} from './ui/editor-fixed-toolbar-panel';
export { EditorMoreMenu } from './ui/editor-more-menu';
export {
  EditorTocSidebar,
  type EditorTocSidebarProps,
} from './ui/editor-toc-sidebar';
export {
  EmojiPickerButton,
  EmojiToolbarButton,
} from './ui/emoji-toolbar-button';
export { EditorStatic } from './ui/editor-static';
export {
  RemoteCursorOverlay,
  type CursorData,
} from './ui/remote-cursor-overlay';
export type { Chat, ChatMessage, ToolName } from './use-chat';
