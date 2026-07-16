// 首次打开 AI 菜单后挂载聊天 transport 与流式正文写入逻辑。
import { BaseAIPlugin } from '@platejs/ai';
import {
  AIChatPlugin,
  getInsertPreviewStart,
  streamInsertChunk,
  useChatChunk,
} from '@platejs/ai/react';
import { ElementApi, getPluginType, KEYS, PathApi } from 'platejs';
import { useEditorPlugin, usePluginOption } from 'platejs/react';

import { useChat } from '../use-chat';

export function AIChatRuntime() {
  const { editor, getOption } = useEditorPlugin(AIChatPlugin);
  const mode = usePluginOption(AIChatPlugin, 'mode');

  useChat();
  useChatChunk({
    onChunk: ({ chunk, isFirst, nodes }) => {
      if (isFirst && mode === 'insert') {
        const { startBlock, startInEmptyParagraph } =
          getInsertPreviewStart(editor);

        editor.getTransforms(BaseAIPlugin).ai.beginPreview({
          originalBlocks:
            startInEmptyParagraph &&
            startBlock &&
            ElementApi.isElement(startBlock)
              ? [structuredClone(startBlock)]
              : [],
        });

        editor.tf.withoutSaving(() => {
          editor.tf.insertNodes(
            {
              children: [{ text: '' }],
              type: getPluginType(editor, KEYS.aiChat),
            },
            {
              at: PathApi.next(editor.selection!.focus.path.slice(0, 1)),
            }
          );
        });
        editor.setOption(AIChatPlugin, 'streaming', true);
      }

      if (mode === 'insert' && nodes.length > 0) {
        editor.tf.withoutSaving(() => {
          if (!getOption('streaming')) return;

          editor.tf.withScrolling(() => {
            streamInsertChunk(editor, chunk, {
              textProps: {
                [getPluginType(editor, KEYS.ai)]: true,
              },
            });
          });
        });
      }
    },
    onFinish: () => {
      editor.getApi(AIChatPlugin).aiChat.stop();
    },
  });

  return null;
}
