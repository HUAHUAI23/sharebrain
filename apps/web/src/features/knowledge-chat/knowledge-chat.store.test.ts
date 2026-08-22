// 验证聊天面板临时状态不会复制路由项目上下文，并可在会话切换时回到消息视图。
import { beforeEach, describe, expect, test } from "bun:test";

import { useKnowledgeChatStore } from "./knowledge-chat.store";

describe("knowledge chat store", () => {
  beforeEach(() => {
    useKnowledgeChatStore.setState({
      open: false,
      showConversations: false,
      selectedConversationId: null,
      newConversationRequested: false,
    });
  });

  test("toggles the panel and selects a conversation", () => {
    useKnowledgeChatStore.getState().toggleOpen();
    useKnowledgeChatStore.getState().setShowConversations(true);
    useKnowledgeChatStore.getState().selectConversation("conversation-1");
    expect(useKnowledgeChatStore.getState()).toMatchObject({
      open: true,
      showConversations: false,
      selectedConversationId: "conversation-1",
    });
    expect("activeProjectId" in useKnowledgeChatStore.getState()).toBe(false);
  });

  test("keeps a user-created blank conversation from auto-selecting history", () => {
    useKnowledgeChatStore.getState().startNewConversation();
    expect(useKnowledgeChatStore.getState()).toMatchObject({
      selectedConversationId: null,
      newConversationRequested: true,
      showConversations: false,
    });
  });
});
