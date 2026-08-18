// 只保存知识聊天面板的临时展示状态；项目上下文始终来自路由。
import { create } from "zustand";

type KnowledgeChatState = {
  open: boolean;
  showConversations: boolean;
  selectedConversationId: string | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setShowConversations: (show: boolean) => void;
  selectConversation: (conversationId: string | null) => void;
};

export const useKnowledgeChatStore = create<KnowledgeChatState>((set) => ({
  open: false,
  showConversations: false,
  selectedConversationId: null,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setShowConversations: (showConversations) => set({ showConversations }),
  selectConversation: (selectedConversationId) => set({
    selectedConversationId,
    showConversations: false,
  }),
}));
