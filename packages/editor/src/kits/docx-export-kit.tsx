import { DocxExportPlugin } from '@platejs/docx-io';
import { KEYS } from 'platejs';

import { CalloutElementDocx } from '../ui/callout-node-static';
import {
  CodeBlockElementDocx,
  CodeLineElementDocx,
  CodeSyntaxLeafDocx,
} from '../ui/code-block-node-static';
import {
  EquationElementDocx,
  InlineEquationElementDocx,
} from '../ui/equation-node-static';
import { TocElementDocx } from '../ui/toc-node-static';

/**
 * Editor kit for DOCX export.
 *
 * Uses docx-specific static components for elements that require inline
 * styles instead of Tailwind classes (which don't survive DOCX conversion):
 * code blocks, equations, callouts, and TOC. Other elements use the regular
 * static components with juice CSS inlining.
 */
export const DocxExportKit = [
  DocxExportPlugin.configure({
    override: {
      components: {
        [KEYS.codeBlock]: CodeBlockElementDocx,
        [KEYS.codeLine]: CodeLineElementDocx,
        [KEYS.codeSyntax]: CodeSyntaxLeafDocx,
        [KEYS.equation]: EquationElementDocx,
        [KEYS.inlineEquation]: InlineEquationElementDocx,
        [KEYS.callout]: CalloutElementDocx,
        [KEYS.toc]: TocElementDocx,
      },
    },
  }),
];
