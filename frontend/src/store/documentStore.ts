import { create } from "zustand";

export interface DocumentPreview {
  path: string;
  filename: string;
  content: string;
  fileType: string;
  isLoading: boolean;
  error: string | null;
}

export interface SelectionAttachment {
  id: string;
  path: string;
  filename: string;
  text: string;
  lines?: [number, number]; // [start, end]
  page?: number;
}

interface DocumentState {
  selectedDocument: DocumentPreview | null;
  textSelections: SelectionAttachment[];
  setSelectedDocument: (doc: DocumentPreview | null) => void;
  setLoading: (path: string, filename: string) => void;
  setContent: (content: string, fileType: string) => void;
  setError: (error: string) => void;
  clearDocument: () => void;
  addSelection: (selection: Omit<SelectionAttachment, "id">) => void;
  removeSelection: (id: string) => void;
  clearSelections: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  selectedDocument: null,
  textSelections: [],
  
  setSelectedDocument: (doc) => set({ selectedDocument: doc }),
  
  setLoading: (path, filename) => set({
    selectedDocument: {
      path,
      filename,
      content: "",
      fileType: "",
      isLoading: true,
      error: null,
    },
  }),
  
  setContent: (content, fileType) => set((state) => ({
    selectedDocument: state.selectedDocument
      ? { ...state.selectedDocument, content, fileType, isLoading: false, error: null }
      : null,
  })),
  
  setError: (error) => set((state) => ({
    selectedDocument: state.selectedDocument
      ? { ...state.selectedDocument, isLoading: false, error }
      : null,
  })),
  
  clearDocument: () => set({ selectedDocument: null }),

  addSelection: (selection) => set((state) => ({
    textSelections: [...state.textSelections, { ...selection, id: Math.random().toString(36).substring(7) }]
  })),

  removeSelection: (id) => set((state) => ({
    textSelections: state.textSelections.filter(s => s.id !== id)
  })),

  clearSelections: () => set({ textSelections: [] }),
}));
