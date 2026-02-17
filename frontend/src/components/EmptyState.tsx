import React, { useState } from "react";
import { FolderOpen, Sparkles, Clock, Loader2 } from "lucide-react";
import { useWorkspaceStore, Workspace } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { useUIStore } from "../store/uiStore";
import { useChatStore } from "../store/chatStore";
import { useConversationStore } from "../store/conversationStore";
import { motion, AnimatePresence } from "framer-motion";

async function invokeOpenWorkspace(path: string): Promise<any> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Opening workspace timed out. Please try again."));
    }, 30000);

    invoke<any>("open_workspace", { path })
      .then((result) => {
        window.clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

const SuggestionChip = ({ text, onClick }: { text: string; onClick: () => void }) => (
  <button 
    onClick={onClick}
    className="flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-accent border border-border/50 rounded-xl text-sm transition-all text-muted-foreground hover:text-foreground hover:scale-[1.02] active:scale-[0.98]"
  >
    <Sparkles size={14} className="opacity-50" />
    <span>{text}</span>
  </button>
);

const RecentWorkspaceCard = ({ workspace, onClick, isLoading, isLoadingThis }: { workspace: Workspace; onClick: () => void; isLoading: boolean; isLoadingThis: boolean }) => (
  <button 
    onClick={onClick}
    disabled={isLoading}
    className={`group flex items-center gap-3 p-3 bg-secondary hover:bg-accent border border-border/40 hover:border-border rounded-2xl transition-all w-full text-left ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-background border border-border/50 group-hover:border-border transition-all">
      {isLoadingThis ? (
        <Loader2 size={18} className="text-foreground animate-spin" />
      ) : (
        <FolderOpen size={18} className="text-muted-foreground group-hover:text-foreground transition-colors" />
      )}
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-[13px] font-semibold truncate leading-tight group-hover:text-foreground transition-colors">{workspace.name}</span>
      <span className="text-[10px] text-muted-foreground/50 truncate font-mono mt-0.5">{workspace.path}</span>
    </div>
  </button>
);

export const EmptyState = () => {
  const { setWorkspace, setWorkspaceReady, recentWorkspaces } = useWorkspaceStore();
  const { clearDocument, clearSelections } = useDocumentStore();
  const { setDocViewerOpen } = useUIStore();
  const { setInputValue, clearPinnedDocs } = useChatStore();
  const { setCurrentConversationId, clearConversations } = useConversationStore();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const openWorkspaceByPath = async (path: string) => {
    setIsLoading(true);
    setLoadingPath(path);
    setWorkspaceReady(false);
    
    // Clear all state before switching
    setCurrentConversationId(null);
    clearConversations();
    setInputValue("");
    clearPinnedDocs();
    clearDocument();
    clearSelections();
    setDocViewerOpen(false);
    
    try {
      const info = await invokeOpenWorkspace(path);
      setWorkspace({
        id: info.workspace_id,
        path: path,
        name: path.split(/[/\\]/).pop() || path,
        documentCount: info.document_count,
        indexedCount: info.indexed_count,
        isIndexing: info.is_indexing,
      });
    } finally {
      setIsLoading(false);
      setLoadingPath(null);
    }
  };

  const handleOpenWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
      });
      
      if (selected && typeof selected === 'string') {
        await openWorkspaceByPath(selected);
      }
    } catch (error) {
      console.error("Failed to open workspace:", error);
      setIsLoading(false);
      setLoadingPath(null);
    }
  };

  const handleOpenRecentWorkspace = async (workspace: Workspace) => {
    try {
      await openWorkspaceByPath(workspace.path);
    } catch (error) {
      console.error("Failed to open recent workspace:", error);
      setIsLoading(false);
      setLoadingPath(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-3xl mx-auto w-full h-full">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full space-y-12"
      >
        {/* Hero Section */}
        <div className="text-center space-y-4">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border text-foreground text-[10px] font-bold uppercase tracking-widest"
          >
            <Sparkles size={12} />
            <span>Atlas Intelligence</span>
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-foreground to-foreground/40"
          >
            Ask questions. <br /> Create documents.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-muted-foreground text-lg max-w-lg mx-auto"
          >
            Open a folder and Atlas will understand everything inside. <br />
            Use <span className="text-foreground font-semibold">@</span> to reference specific files.
          </motion.p>
        </div>

        {/* Suggestion Chips */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex flex-wrap justify-center gap-3"
        >
          <SuggestionChip text="Summarize the key findings" onClick={() => setInputValue("Summarize the key findings")} />
          <SuggestionChip text="Compare these documents" onClick={() => setInputValue("Compare these documents")} />
          <SuggestionChip text="Find all mentions of budget" onClick={() => setInputValue("Find all mentions of budget")} />
        </motion.div>

        {/* Action Center */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-secondary/50 border border-border/40 rounded-[2.5rem] p-10 space-y-8 relative"
        >
          <div className="flex flex-col items-center gap-6">
            <button 
              onClick={handleOpenWorkspace}
              disabled={isLoading}
              className={`group relative flex items-center justify-center gap-3 px-8 py-4 bg-foreground text-background rounded-2xl font-bold text-lg hover:opacity-90 active:scale-[0.98] transition-all ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading && !loadingPath ? (
                <Loader2 size={24} strokeWidth={2.5} className="animate-spin" />
              ) : (
                <FolderOpen size={24} strokeWidth={2.5} />
              )}
              <span>{isLoading && !loadingPath ? 'Opening...' : 'Open Folder'}</span>
            </button>
            
            {recentWorkspaces.length > 0 && (
              <div className="w-full max-w-sm space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <Clock size={12} className="text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Recent Workspaces</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {recentWorkspaces.map((workspace) => (
                    <RecentWorkspaceCard 
                      key={workspace.path} 
                      workspace={workspace} 
                      onClick={() => handleOpenRecentWorkspace(workspace)}
                      isLoading={isLoading}
                      isLoadingThis={loadingPath === workspace.path}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Loading Overlay */}
          <AnimatePresence>
            {isLoading && loadingPath && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-[2.5rem] flex flex-col items-center justify-center gap-4"
              >
                <Loader2 size={32} className="animate-spin text-foreground" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">Opening workspace...</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-[280px]">
                    {loadingPath.split(/[/\\]/).pop()}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
};
