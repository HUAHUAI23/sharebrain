import { create } from "zustand";

type WorkspaceState = {
  sidebarCollapsed: boolean;
  activePanel: "documents" | "search" | "timeline";
  toggleSidebar: () => void;
  setActivePanel: (panel: WorkspaceState["activePanel"]) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sidebarCollapsed: false,
  activePanel: "documents",
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setActivePanel: (activePanel) => set({ activePanel }),
}));
