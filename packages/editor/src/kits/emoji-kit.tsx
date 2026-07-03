import emojiMartData from '@emoji-mart/data';
import { EmojiInputPlugin, EmojiPlugin } from '@platejs/emoji/react';

import { EmojiCaretPickerPlugin } from '../ui/emoji-caret-picker';
import { EmojiInputElement } from '../ui/emoji-node';

export const EmojiKit = [
  EmojiPlugin.configure({
    options: { data: emojiMartData as any },
  }),
  EmojiInputPlugin.withComponent(EmojiInputElement),
  EmojiCaretPickerPlugin,
];
