import { BaseAlignKit } from './kits/align-base-kit';
import { BaseBasicBlocksKit } from './kits/basic-blocks-base-kit';
import { BaseBasicMarksKit } from './kits/basic-marks-base-kit';
import { BaseCalloutKit } from './kits/callout-base-kit';
import { BaseCodeBlockKit } from './kits/code-block-base-kit';
import { BaseFontKit } from './kits/font-base-kit';
import { BaseLineHeightKit } from './kits/line-height-base-kit';
import { BaseLinkKit } from './kits/link-base-kit';
import { BaseListKit } from './kits/list-base-kit';
import { MarkdownKit } from './kits/markdown-kit';
import { BaseMathKit } from './kits/math-base-kit';
import { BaseMediaKit } from './kits/media-base-kit';
import { BaseMentionKit } from './kits/mention-base-kit';
import { BaseTableKit } from './kits/table-base-kit';
import { BaseTocKit } from './kits/toc-base-kit';
import { BaseToggleKit } from './kits/toggle-base-kit';

export const BaseEditorKit = [
  ...BaseBasicBlocksKit,
  ...BaseCodeBlockKit,
  ...BaseTableKit,
  ...BaseToggleKit,
  ...BaseTocKit,
  ...BaseMediaKit,
  ...BaseCalloutKit,
  ...BaseMathKit,
  ...BaseLinkKit,
  ...BaseMentionKit,
  ...BaseBasicMarksKit,
  ...BaseFontKit,
  ...BaseListKit,
  ...BaseAlignKit,
  ...BaseLineHeightKit,
  ...MarkdownKit,
];
