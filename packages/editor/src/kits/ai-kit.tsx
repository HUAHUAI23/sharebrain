// 注册轻量 AI 编辑协议；聊天 SDK 与流式运行时在首次打开菜单时加载。
import * as React from 'react';

import {
  AIChatPlugin,
  AIPlugin,
} from '@platejs/ai/react';
import { usePluginOption } from 'platejs/react';

import { AILoadingBar, AIMenu } from '../ui/ai-menu';
import { AIAnchorElement, AILeaf } from '../ui/ai-node';

import { CursorOverlayKit } from './cursor-overlay-kit';
import { MarkdownKit } from './markdown-kit';

type AIChatRuntimeComponent = typeof import('../ui/ai-chat-runtime').AIChatRuntime;

function AIChatRuntimeLoader() {
  const open = usePluginOption(AIChatPlugin, 'open');
  const [Runtime, setRuntime] = React.useState<AIChatRuntimeComponent | null>(
    null
  );

  React.useEffect(() => {
    if (!open || Runtime) return;

    let active = true;

    void import('../ui/ai-chat-runtime').then(({ AIChatRuntime }) => {
      if (active) setRuntime(() => AIChatRuntime);
    });

    return () => {
      active = false;
    };
  }, [open, Runtime]);

  return Runtime ? <Runtime /> : null;
}

function AIContainerRuntime() {
  return (
    <>
      <AILoadingBar />
      <AIChatRuntimeLoader />
    </>
  );
}

export const aiChatPlugin = AIChatPlugin.extend({
  options: {
    chatOptions: {
      api: '/api/ai/command',
      body: {},
    },
  },
  render: {
    afterContainer: AIContainerRuntime,
    afterEditable: AIMenu,
    node: AIAnchorElement,
  },
  shortcuts: { show: { keys: 'mod+j' } },
});

export const AIKit = [
  ...CursorOverlayKit,
  ...MarkdownKit,
  AIPlugin.withComponent(AILeaf),
  aiChatPlugin,
];
