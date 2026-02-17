import { useState, useEffect, ReactNode } from "react";
import { MessageSquare, Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface Conversation {
  id: string;
  workspace_id: string;
  title: string | null;
  created_at: string | null;
  last_message_at: string | null;
  preview: string | null;
}

interface ChatListProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString();
}

export default function ChatList({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}: ChatListProps): ReactNode {
  const { currentWorkspace } = useWorkspaceStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    if (!currentWorkspace || !isTauri) return;

    const loadConversations = async () => {
      try {
        setIsLoading(true);
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<Conversation[]>("list_conversations", {
          workspaceId: currentWorkspace.id,
        });
        setConversations(result || []);
      } catch (error) {
        console.error("Failed to load conversations:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConversations();
  }, [currentWorkspace?.id]);

  const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (!currentWorkspace || !isTauri) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_conversation", {
        workspaceId: currentWorkspace.id,
        conversationId,
      });
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      // If we deleted the current conversation, trigger new one
      if (currentConversationId === conversationId) {
        onNewConversation();
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title || "");
  };

  const handleSaveEdit = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (!currentWorkspace || !isTauri) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_conversation_title", {
        workspaceId: currentWorkspace.id,
        conversationId,
        title: editTitle,
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId ? { ...c, title: editTitle } : c
        )
      );
    } catch (error) {
      console.error("Failed to update conversation title:", error);
    } finally {
      setEditingId(null);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditTitle("");
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header with New Chat button */}
      <div className="p-4 border-b border-border/20 bg-background/10 backdrop-blur-sm">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl text-xs font-bold tracking-wider uppercase transition-all shadow-lg shadow-primary/10 active:scale-95"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground opacity-50">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Syncing</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
            <MessageSquare className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest opacity-40">
              No History
            </p>
          </div>
        ) : (
          <div className="py-2 px-2 space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`group relative px-3 py-3 cursor-pointer rounded-xl transition-all border border-transparent ${
                  currentConversationId === conv.id 
                    ? "bg-accent text-accent-foreground border-border/50 shadow-sm" 
                    : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${currentConversationId === conv.id ? "bg-primary text-primary-foreground" : "bg-muted/50 group-hover:bg-background transition-colors"}`}>
                    <MessageSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingId === conv.id ? (
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="flex-1 bg-background text-xs px-2 py-1.5 rounded-md border border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary"
                          autoFocus
                        />
                        <button
                          onClick={(e) => handleSaveEdit(e, conv.id)}
                          className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded-md transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 text-muted-foreground hover:bg-muted rounded-md transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate leading-tight">
                            {conv.title || "Untitled Chat"}
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-tighter opacity-40 whitespace-nowrap">
                            {formatTime(conv.last_message_at)}
                          </span>
                        </div>
                        {conv.preview && (
                          <p className="text-[10px] leading-relaxed truncate mt-1 opacity-60 italic">
                            {conv.preview}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                
                {/* Hover Actions */}
                  {editingId !== conv.id && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100">
                      <button
                        onClick={(e) => handleStartEdit(e, conv)}
                      className="p-1.5 bg-background border border-border shadow-sm text-muted-foreground hover:text-primary rounded-lg transition-all"
                      title="Rename"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, conv.id)}
                      className="p-1.5 bg-background border border-border shadow-sm text-muted-foreground hover:text-destructive rounded-lg transition-all"
                      title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
