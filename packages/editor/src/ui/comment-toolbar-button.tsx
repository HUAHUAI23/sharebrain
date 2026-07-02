


import { MessageSquareTextIcon } from 'lucide-react';
import { useEditorRef } from 'platejs/react';
import { m } from '@sharebrain/i18n';

import { commentPlugin } from '../kits/comment-kit';

import { ToolbarButton } from './toolbar';

export function CommentToolbarButton() {
  const editor = useEditorRef();

  return (
    <ToolbarButton
      onClick={() => {
        editor.getTransforms(commentPlugin).comment.setDraft();
      }}
      data-plate-prevent-overlay
      tooltip={m.editor_comment()}
    >
      <MessageSquareTextIcon />
    </ToolbarButton>
  );
}
