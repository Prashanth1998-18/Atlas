import { create } from "zustand";

interface ChatState {
  inputValue: string;
  pinnedDocPaths: string[];
  
  // Actions
  setInputValue: (value: string) => void;
  appendReference: (docName: string, docPath: string) => void;
  addPinnedDoc: (path: string) => void;
  removePinnedDoc: (path: string) => void;
  clearPinnedDocs: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  inputValue: "",
  pinnedDocPaths: [],

  setInputValue: (value) => set({ inputValue: value }),
  
  appendReference: (docName, docPath) => set((state) => {
    const hasReference = state.inputValue.includes(`@${docName}`);
    if (hasReference) return state;
    
    return {
      inputValue: state.inputValue.trim() + (state.inputValue.trim() ? " " : "") + `@${docName} `,
      pinnedDocPaths: state.pinnedDocPaths.includes(docPath) 
        ? state.pinnedDocPaths 
        : [...state.pinnedDocPaths, docPath]
    };
  }),

  addPinnedDoc: (path) => set((state) => ({
    pinnedDocPaths: state.pinnedDocPaths.includes(path) 
      ? state.pinnedDocPaths 
      : [...state.pinnedDocPaths, path]
  })),

  removePinnedDoc: (path) => set((state) => ({
    pinnedDocPaths: state.pinnedDocPaths.filter(p => p !== path)
  })),

  clearPinnedDocs: () => set({ pinnedDocPaths: [] }),
}));
