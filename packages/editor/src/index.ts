export {
  getEditableChunkDescriptor,
  getEditableChunkRange,
  selectionPinsEditableChunk,
  type EditableChunkDescriptor,
  type EditableChunkRange,
} from './lib/editable-chunk-window-core';
export { installSafeEditorNodeLookup } from './lib/safe-editor-node-lookup';
export {
  EDITOR_VERSION_DIFF_INPUT_BUDGET,
  EDITOR_VERSION_DIFF_RESULT_BUDGET,
  cloneEditorVersionValue,
  computeEditorVersionDiffCore,
  estimateEditorVersionValue,
  getEditorVersionDiffSegments,
  hasEditorVersionDiff,
  isEditorVersionDiffWithinBudget,
  isEditorVersionValueWithinBudget,
  type EditorVersionDiffSegment,
  type EditorVersionValueBudget,
} from './lib/version-history-core';
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
export {
  getEditorWordClipboardPayload,
  parseEditorWordClipboard,
  type EditorWordClipboardPayload,
} from './lib/exports';
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
  EditableChunkFallback,
  EditableChunkWindow,
  EditableChunkWindowProvider,
  useEditableChunkMountRevision,
  useEditableChunkWindow,
} from './ui/editable-chunk-window';
export { EditorWindowFind } from './ui/editor-window-find';
export {
  EditorFixedToolbarPanel,
  type EditorFixedToolbarPanelProps,
} from './ui/editor-fixed-toolbar-panel';
export { EditorMoreMenu } from './ui/editor-more-menu';
export {
  getSuggestionModeToggleState,
  SuggestionModeToggle,
  type SuggestionModeToggleState,
} from './ui/suggestion-mode-toggle';
export {
  EditorTocSidebar,
  type EditorTocSidebarProps,
} from './ui/editor-toc-sidebar';
export {
  EmojiPickerButton,
  EmojiToolbarButton,
} from './ui/emoji-toolbar-button';
export {
  RemoteCursorOverlay,
  type CursorData,
} from './ui/remote-cursor-overlay';
export type { Chat, ChatMessage, ToolName } from './use-chat';
