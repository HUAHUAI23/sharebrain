// 为窗口化编辑器建立纯 Slate 文本索引，并将查询偏移映射回精确 text range。
import { ElementApi, NodeApi, type TElement, type TRange, type Value } from 'platejs';

export type EditableWindowTextBlock = {
  id: string;
  path: number[];
  text: string;
};

export type EditableWindowTextMatch = {
  blockId: string;
  blockPath: number[];
  end: number;
  range: TRange;
  start: number;
};

export const shouldNavigateEditableWindowFind = ({
  composing,
  matchCount,
  open,
}: {
  composing: boolean;
  matchCount: number;
  open: boolean;
}) => open && !composing && matchCount > 0;

const getPointAtTextOffset = (
  node: TElement,
  blockPath: number[],
  requestedOffset: number,
  affinity: 'backward' | 'forward'
) => {
  const offset = Math.max(0, Math.floor(requestedOffset));
  const textEntries = Array.from(NodeApi.texts(node));
  let consumed = 0;

  for (let index = 0; index < textEntries.length; index += 1) {
    const [text, relativePath] = textEntries[index]!;
    const nextConsumed = consumed + text.text.length;

    if (
      (affinity === 'forward' ? offset < nextConsumed : offset <= nextConsumed) ||
      index === textEntries.length - 1
    ) {
      return {
        offset: Math.max(0, Math.min(text.text.length, offset - consumed)),
        path: [...blockPath, ...relativePath],
      };
    }

    consumed = nextConsumed;
  }

  return null;
};

export function buildEditableWindowTextIndex(
  value: Value
): EditableWindowTextBlock[] {
  return value.flatMap((node, index) => {
    if (!ElementApi.isElement(node)) return [];

    const text = NodeApi.string(node);

    if (text.length === 0) return [];

    return [
      {
        id: typeof node.id === 'string' ? node.id : '',
        path: [index],
        text,
      },
    ];
  });
}

export function findEditableWindowTextMatches(
  value: Value,
  query: string,
  maximumMatches = 1_000
): EditableWindowTextMatch[] {
  return findEditableWindowTextIndexMatches(
    value,
    buildEditableWindowTextIndex(value),
    query,
    maximumMatches
  );
}

export function findEditableWindowTextIndexMatches(
  value: Value,
  textIndex: readonly EditableWindowTextBlock[],
  query: string,
  maximumMatches = 1_000
): EditableWindowTextMatch[] {
  const normalizedQuery = query.toLocaleLowerCase();

  if (normalizedQuery.length === 0) return [];

  const limit = Math.max(1, Math.floor(maximumMatches));
  const matches: EditableWindowTextMatch[] = [];

  for (const block of textIndex) {
    const node = NodeApi.getIf({ children: value } as TElement, block.path);

    if (!ElementApi.isElement(node)) continue;

    const normalizedText = block.text.toLocaleLowerCase();
    let start = 0;

    while (start <= normalizedText.length - normalizedQuery.length) {
      const matchStart = normalizedText.indexOf(normalizedQuery, start);

      if (matchStart < 0) break;

      const matchEnd = matchStart + normalizedQuery.length;
      const anchor = getPointAtTextOffset(
        node,
        block.path,
        matchStart,
        'forward'
      );
      const focus = getPointAtTextOffset(
        node,
        block.path,
        matchEnd,
        'backward'
      );

      if (anchor && focus) {
        matches.push({
          blockId: block.id,
          blockPath: block.path,
          end: matchEnd,
          range: { anchor, focus },
          start: matchStart,
        });
      }

      if (matches.length >= limit) return matches;

      start = matchStart + Math.max(1, normalizedQuery.length);
    }
  }

  return matches;
}
