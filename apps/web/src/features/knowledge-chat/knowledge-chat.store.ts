// 只保存知识聊天面板的临时展示状态；项目上下文始终来自路由。
import { create } from "zustand";

type KnowledgeChatState = {
  open: boolean;
  showConversations: boolean;
  selectedConversationId: string | null;
  newConversationRequested: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setShowConversations: (show: boolean) => void;
  startNewConversation: () => void;
  selectConversation: (conversationId: string | null) => void;
};

export const useKnowledgeChatStore = create<KnowledgeChatState>((set) => ({
  open: false,
  showConversations: false,
  selectedConversationId: null,
  newConversationRequested: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setShowConversations: (showConversations) => set({ showConversations }),
  startNewConversation: () => set({
    selectedConversationId: null,
    newConversationRequested: true,
    showConversations: false,
  }),
  selectConversation: (selectedConversationId) => set({
    selectedConversationId,
    newConversationRequested: false,
    showConversations: false,
  }),
}));
