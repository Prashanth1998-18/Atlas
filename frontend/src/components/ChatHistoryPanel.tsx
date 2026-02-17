import React, { useEffect, useState } from "react";
import { MessageSquare, Clock, Trash2, FolderOpen, Edit2, Check, X, MoreHorizontal } from "lucide-react";
import { useConversationStore } from "../store/conversationStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUIStore } from "../store/uiStore";
import { useDocumentStore } from "../store/documentStore";
import { PanelHeader } from "./ExpandablePanel";
import { cn } from "../lib/utils";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ChatHistoryPanel = () => {
  const { conversations, currentConversationId, setCurrentConversationId, setConversations, removeConversation, updateConversation } = useConversationStore();
  const { currentWorkspace, isWorkspaceReady, setWorkspace, setWorkspaceReady } = useWorkspaceStore();
  const { setActivePanel, setDocViewerOpen } = useUIStore();
  const { clearDocument, clearSelections } = useDocumentStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // Load conversations from backend when workspace is ready
  useEffect(() => {
    const loadConversations = async () => {
      // Only load when workspace is fully opened on backend
      if (!currentWorkspace || !isTauri || !isWorkspaceReady) return;
      
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<Array<{
          id: string;
          workspace_id: string;
          title: string | null;
          created_at: string | null;
          last_message_at: string | null;
          preview: string | null;
        }>>("list_conversations", { workspaceId: currentWorkspace.id });
        
        setConversations(result.map(c => ({
          id: c.id,
          workspaceId: c.workspace_id,
          title: c.title,
          createdAt: c.created_at || undefined,
          lastMessageAt: c.last_message_at || undefined,
          preview: c.preview || undefined,
        })));
      } catch (error) {
        console.error("Failed to load conversations:", error);
      }
    };

    loadConversations();
  }, [currentWorkspace?.id, isWorkspaceReady, setConversations]);

  const handleOpenWorkspace = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
      });
      
      if (selected && typeof selected === 'string') {
        setWorkspaceReady(false);
        
        // Clear document viewer state
        clearDocument();
        clearSelections();
        setDocViewerOpen(false);
        
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<any>("open_workspace", { path: selected });
        
        setWorkspace({
          id: info.workspace_id,
          path: selected,
          name: selected.split(/[/\\]/).pop() || selected,
          documentCount: info.document_count,
          indexedCount: info.indexed_count,
          isIndexing: info.is_indexing,
        });
      }
    } catch (error) {
      console.error("Failed to open workspace:", error);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!currentWorkspace || !isTauri) return;
    
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_conversation", { 
        workspaceId: currentWorkspace.id, 
        conversationId: convId 
      });
      removeConversation(convId);
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, convId: string, title: string | null) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setEditingId(convId);
    setEditTitle(title || "");
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(null);
    setEditTitle("");
  };

  const handleSaveEdit = async (convId: string) => {
    if (!currentWorkspace || !isTauri || isSavingTitle) return;

    const nextTitle = editTitle.trim() || "Untitled Conversation";

    try {
      setIsSavingTitle(true);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_conversation_title", {
        workspaceId: currentWorkspace.id,
        conversationId: convId,
        title: nextTitle,
      });
      updateConversation(convId, { title: nextTitle });
      setEditingId(null);
      setEditTitle("");
    } catch (error) {
      console.error("Failed to rename conversation:", error);
    } finally {
      setIsSavingTitle(false);
    }
  };

  useEffect(() => {
    if (!menuOpenId) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".thread-menu-container")) {
        setMenuOpenId(null);
      }
    };

    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [menuOpenId]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader 
        title="Chat History" 
        onClose={() => setActivePanel(null)}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
        {!currentWorkspace ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FolderOpen size={40} className="mb-4 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium mb-1">No workspace is open</p>
            <p className="text-xs text-muted-foreground mb-4">Open a workspace to view chat history</p>
            <button
              onClick={handleOpenWorkspace}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Open Workspace
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-50">
            <MessageSquare size={32} className="mb-2" />
            <p className="text-xs">No conversations yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="space-y-1 px-2">
            {conversations.map((conv, i) => (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                key={conv.id}
                onClick={() => {
                  if (editingId !== conv.id) {
                    setCurrentConversationId(conv.id);
                    setMenuOpenId(null);
                  }
                }}
                className={cn(
                  "group relative flex items-start gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all border",
                  currentConversationId === conv.id
                    ? "bg-accent border-border text-foreground"
                    : "hover:bg-accent/50 border-transparent text-foreground"
                )}
              >
                <div className={cn(
                  "mt-0.5 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border",
                  currentConversationId === conv.id
                    ? "bg-secondary border-border"
                    : "bg-background border-border/50 group-hover:border-border"
                )}>
                  <MessageSquare size={14} className={currentConversationId === conv.id ? "text-foreground" : "text-muted-foreground"} />
                </div>
                
                <div className="flex-1 min-w-0">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleSaveEdit(conv.id);
                          } else if (e.key === "Escape") {
                            handleCancelEdit();
                          }
                        }}
                        className="flex-1 bg-background text-[13px] font-semibold leading-tight px-2 py-1.5 rounded-md border border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleSaveEdit(conv.id);
                        }}
                        disabled={isSavingTitle}
                        className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded-md transition-colors disabled:opacity-40"
                        title="Save title"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={(e) => handleCancelEdit(e)}
                        className="p-1 text-muted-foreground hover:bg-muted rounded-md transition-colors"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[13px] font-semibold truncate leading-tight">
                        {conv.title || "Untitled Conversation"}
                      </h3>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 opacity-50">
                    <Clock size={10} />
                    <span className="text-[10px] font-medium uppercase tracking-tight">
                      {conv.lastMessageAt 
                        ? formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true })
                        : conv.createdAt 
                          ? formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })
                          : "Just now"}
                    </span>
                  </div>
                </div>
                
                {editingId !== conv.id && (
                  <div className="thread-menu-container ml-1 relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId((prev) => (prev === conv.id ? null : conv.id));
                      }}
                      className={cn(
                        "p-1 rounded transition-all",
                        menuOpenId === conv.id
                          ? "opacity-100 text-foreground bg-muted"
                          : "opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted"
                      )}
                      title="Thread options"
                    >
                      <MoreHorizontal size={14} />
                    </button>

                    {menuOpenId === conv.id && (
                      <div className="absolute right-0 top-8 z-40 min-w-[140px] rounded-xl border border-border bg-popover shadow-xl p-1.5 font-sans">
                        <button
                          onClick={(e) => handleStartEdit(e, conv.id, conv.title)}
                          className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[13px] font-semibold leading-tight text-foreground hover:bg-muted rounded-md transition-colors"
                        >
                          <Edit2 size={14} />
                          <span>Rename</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            handleDeleteConversation(conv.id);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[13px] font-semibold leading-tight text-destructive hover:bg-muted rounded-md transition-colors"
                        >
                          <Trash2 size={14} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
                  </div>
        )}
      </div>
    </div>
  );
};
