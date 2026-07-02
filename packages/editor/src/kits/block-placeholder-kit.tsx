

import { KEYS } from 'platejs';
import { m } from '@sharebrain/i18n';
import { BlockPlaceholderPlugin } from 'platejs/react';

export const BlockPlaceholderKit = [
  BlockPlaceholderPlugin.configure({
    options: {
      className:
        'before:absolute before:cursor-text before:text-muted-foreground/80 before:content-[attr(placeholder)]',
      placeholders: {
        [KEYS.p]: m.editor_placeholder(),
      },
      query: ({ path }) => path.length === 1,
    },
  }),
];
