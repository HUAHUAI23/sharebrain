import * as React from 'react';

import { type UseChatHelpers, useChat as useBaseChat } from '@ai-sdk/react';
import { AIChatPlugin } from '@platejs/ai/react';
import { type UIMessage, DefaultChatTransport } from 'ai';
import { createSlateEditor } from 'platejs';
import { useEditorRef, usePluginOption } from 'platejs/react';

import { BaseEditorKit } from './editor-base-kit';
import { aiChatPlugin } from './kits/ai-kit';
import { getGeneratePrompt } from './lib/generate-prompt';

export type ToolName = 'comment' | 'edit' | 'generate';

export type MessageDataPart = {
  toolName: ToolName;
};

export type Chat = UseChatHelpers<ChatMessage>;

export type ChatMessage = UIMessage<unknown, MessageDataPart>;

type SubmitContext = {
  children?: unknown;
  selection?: unknown;
  toolName?: ToolName | null;
};

/**
 * Chat transport for the ShareBrain AI command route. The prompt is built on
 * the client from the editor context captured by AIChatPlugin, so the API
 * stays a thin authenticated streaming proxy.
 */
function createChatTransport(api: string) {
  return new DefaultChatTransport({
    api,
    credentials: 'include',
    fetch: async (input, init) => {
      const initBody = JSON.parse((init?.body as string) ?? '{}') as {
        ctx?: SubmitContext;
        messages?: ChatMessage[];
      };

      const ctx = initBody.ctx ?? {};
      const contextEditor = createSlateEditor({
        plugins: BaseEditorKit,
        selection: (ctx.selection as never) ?? null,
        value: (ctx.children as never) ?? [],
      });
      const isSelecting = contextEditor.api.isExpanded();

      const prompt = getGeneratePrompt(contextEditor, {
        isSelecting,
        messages: initBody.messages ?? [],
      });

      return fetch(input, {
        ...init,
        body: JSON.stringify({
          prompt,
          toolName: ctx.toolName ?? 'generate',
        }),
      });
    },
  });
}

export const useChat = () => {
  const editor = useEditorRef();
  const options = usePluginOption(aiChatPlugin, 'chatOptions');

  const transport = React.useMemo(
    () => createChatTransport(options.api || '/api/ai/command'),
    [options.api],
  );

  const chat = useBaseChat<ChatMessage>({
    id: 'editor',
    transport,
    onData(data) {
      if (data.type === 'data-toolName') {
        editor.setOption(AIChatPlugin, 'toolName', data.data as ToolName);
      }
    },
    ...options,
  });

  React.useEffect(() => {
    editor.setOption(AIChatPlugin, 'chat', chat as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, chat.messages, chat.error]);

  return chat;
};
