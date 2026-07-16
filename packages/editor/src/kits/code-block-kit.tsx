

// 配置可编辑代码块，并复用按需扩展的语法高亮注册表。
import { CodeBlockRules } from '@platejs/code-block';
import {
  CodeBlockPlugin,
  CodeLinePlugin,
  CodeSyntaxPlugin,
} from '@platejs/code-block/react';

import { codeBlockLowlight } from '../lib/code-block-lowlight';
import {
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
} from '../ui/code-block-node';

export const CodeBlockKit = [
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: 'match' })],
    node: { component: CodeBlockElement },
    options: { lowlight: codeBlockLowlight },
    shortcuts: { toggle: { keys: 'mod+alt+8' } },
  }),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
];
