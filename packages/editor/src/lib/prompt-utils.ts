import type { UIMessage } from 'ai';

import { getMarkdown } from '@platejs/ai';
import { serializeMd } from '@platejs/markdown';
import { type SlateEditor, RangeApi } from 'platejs';

export const tag = (name: string, content?: string | null) => {
  if (!content) return '';

  return [`<${name}>`, content, `</${name}>`].join('\n');
};

export const sections = (parts: (boolean | string | null | undefined)[]) =>
  parts.filter(Boolean).join('\n\n');

export type StructuredPromptSections = {
  context?: string;
  examples?: string[] | string;
  history?: string;
  instruction?: string;
  rules?: string;
  task?: string;
};

export const buildStructuredPrompt = ({
  context,
  examples,
  history,
  instruction,
  rules,
  task,
}: StructuredPromptSections) => {
  const formattedExamples = Array.isArray(examples)
    ? examples
        .map((example) => ['<example>', example.trim(), '</example>'].join('\n'))
        .join('\n')
    : examples;

  return sections([
    task && tag('task', task),
    instruction &&
      `Here is the user's instruction (this is what you need to respond to):\n${tag('instruction', instruction)}`,
    context &&
      `Here is the context you should reference when answering the user:\n${tag('context', context)}`,
    rules && tag('rules', rules),
    formattedExamples &&
      `Here are some examples of how to respond in a standard interaction:\n${tag('examples', formattedExamples)}`,
    history &&
      `Here is the conversation history (between the user and you) prior to the current instruction:\n${tag('history', history)}`,
  ]);
};

export function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function formatTextFromMessages(
  messages: UIMessage[],
  options?: { limit?: number },
): string {
  if (!messages || messages.length <= 1) return '';

  const historyMessages = options?.limit
    ? messages.slice(-options.limit)
    : messages;

  return historyMessages
    .map((message) => {
      const text = getTextFromMessage(message).trim();

      if (!text) return null;

      return `${message.role.toUpperCase()}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function getLastUserInstruction(messages: UIMessage[]): string {
  if (!messages || messages.length === 0) return '';

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUserMessage) return '';

  return getTextFromMessage(lastUserMessage).trim();
}

const SELECTION_START = '<Selection>';
const SELECTION_END = '</Selection>';

export const addSelection = (editor: SlateEditor) => {
  if (!editor.selection) return;
  if (editor.api.isExpanded()) {
    const [start, end] = RangeApi.edges(editor.selection);

    editor.tf.withoutNormalizing(() => {
      editor.tf.insertText(SELECTION_END, {
        at: end,
      });

      editor.tf.insertText(SELECTION_START, {
        at: start,
      });
    });
  }
};

const removeEscapeSelection = (editor: SlateEditor, text: string) => {
  let newText = text
    .replace(`\\${SELECTION_START}`, SELECTION_START)
    .replace(`\\${SELECTION_END}`, SELECTION_END);

  // Void elements reject inserted marker text, so patch the serialized string.
  if (!newText.includes(SELECTION_END) && editor.selection) {
    const [, end] = RangeApi.edges(editor.selection);

    const node = editor.api.block({ at: end.path });

    if (!node) return newText;
    if (editor.api.isVoid(node[0])) {
      const voidString = serializeMd(editor, { value: [node[0]] });

      const idx = newText.lastIndexOf(voidString);

      if (idx !== -1) {
        newText =
          newText.slice(0, idx) +
          voidString.trimEnd() +
          SELECTION_END +
          newText.slice(idx + voidString.length);
      }
    }
  }

  return newText;
};

/** Check if the current selection spans more than one lowest-level block. */
export const isMultiBlocks = (editor: SlateEditor) => {
  const blocks = editor.api.blocks({ mode: 'lowest' });

  return blocks.length > 1;
};

/** Get markdown with selection markers. */
export const getMarkdownWithSelection = (editor: SlateEditor) =>
  removeEscapeSelection(editor, getMarkdown(editor, { type: 'block' }));
