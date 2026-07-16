// 配置静态代码块，并与可编辑正文共享精简的按需语法注册表。
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
} from '@platejs/code-block';

import { codeBlockLowlight } from '../lib/code-block-lowlight';
import {
  CodeBlockElementStatic,
  CodeLineElementStatic,
  CodeSyntaxLeafStatic,
} from '../ui/code-block-node-static';

export const BaseCodeBlockKit = [
  BaseCodeBlockPlugin.configure({
    node: { component: CodeBlockElementStatic },
    options: { lowlight: codeBlockLowlight },
  }),
  BaseCodeLinePlugin.withComponent(CodeLineElementStatic),
  BaseCodeSyntaxPlugin.withComponent(CodeSyntaxLeafStatic),
];
