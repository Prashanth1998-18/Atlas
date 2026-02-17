import { create } from "zustand";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ doc: string; page?: number }>;
  pinnedDocs?: string[];
  createdAt?: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  preview?: string;
  messages?: Message[];
}

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  clearConversations: () => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: [],
  currentConversationId: null,
  isLoading: false,

  setConversations: (conversations) => set({ conversations }),

  setCurrentConversationId: (id) => set({ currentConversationId: id }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      currentConversationId:
        state.currentConversationId === id ? null : state.currentConversationId,
    })),

  clearConversations: () => set({ conversations: [], currentConversationId: null }),

  setLoading: (loading) => set({ isLoading: loading }),

  reset: () =>
    set({
      conversations: [],
      currentConversationId: null,
      isLoading: false,
    }),
}));

