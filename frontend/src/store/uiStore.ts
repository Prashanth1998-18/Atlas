import { create } from "zustand";

export type ActivePanel = "files" | "history" | null;

interface UIState {
  activePanel: ActivePanel;
  isSidebarCollapsed: boolean;
  theme: "light" | "dark";
  isDocViewerOpen: boolean;
  docViewerWidth: number; // percentage
  
  // Actions
  setActivePanel: (panel: ActivePanel) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  setDocViewerOpen: (isOpen: boolean) => void;
  setDocViewerWidth: (width: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activePanel: null,
  isSidebarCollapsed: false,
  theme: "dark",
  isDocViewerOpen: false,
  docViewerWidth: 55,

  setActivePanel: (panel) => set((state) => ({ 
    activePanel: state.activePanel === panel ? null : panel 
  })),
  
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  
  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      const root = window.document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(theme);
    }
    set({ theme });
  },

  toggleTheme: () => set((state) => {
    const nextTheme = state.theme === "light" ? "dark" : "light";
    if (typeof window !== "undefined") {
      const root = window.document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(nextTheme);
    }
    return { theme: nextTheme };
  }),

  setDocViewerOpen: (isOpen) => set({ isDocViewerOpen: isOpen }),
  setDocViewerWidth: (width) => set({ docViewerWidth: Math.max(20, Math.min(80, width)) }),
}));
