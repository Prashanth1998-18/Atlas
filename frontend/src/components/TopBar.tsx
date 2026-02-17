import React from "react";
import { ChevronRight, MessageSquare, Layout } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useConversationStore } from "../store/conversationStore";

export const TopBar = () => {
  const { currentWorkspace, indexingStatusMessage, indexingProgress } = useWorkspaceStore();
  const { currentConversationId, conversations } = useConversationStore();

  const currentConversation = conversations.find(c => c.id === currentConversationId);
  const workspaceName = currentWorkspace?.name || "No Workspace";
  const chatName = currentConversation?.title || "New Chat";
  const totalFiles = indexingProgress?.totalFiles || 0;
  const processedFiles = Math.min(indexingProgress?.processedFiles || 0, totalFiles || 0);
  const overallProgress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-background border-b border-border/50 z-10">
      {/* Left: Breadcrumbs */}
      <div className="flex-1 flex items-center gap-2 text-sm min-w-0">
        <div className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0">
          <Layout size={14} />
          <span className="font-medium tracking-tight truncate max-w-[150px]">{workspaceName}</span>
        </div>
        <ChevronRight size={14} className="text-muted-foreground/30 shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={14} className="text-muted-foreground shrink-0" />
          <span className="font-semibold text-foreground tracking-tight truncate">{chatName}</span>
        </div>
      </div>

      {/* Center: View Toggle */}
      <div className="flex items-center bg-secondary p-1 rounded-xl border border-border/50">
        <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent text-foreground text-xs font-semibold transition-all">
          <MessageSquare size={14} />
          <span>Chat</span>
        </button>
        <div className="relative group">
          <button 
            disabled
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-muted-foreground/50 text-xs font-semibold cursor-not-allowed"
          >
            <Layout size={14} />
            <span>Editor</span>
          </button>
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-popover text-popover-foreground text-[10px] font-bold rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
            COMING SOON
          </div>
        </div>
      </div>

      {/* Right: Indexing Status */}
      <div className="flex-1 flex justify-end">
        {currentWorkspace?.isIndexing && (
          <div className="w-full max-w-[360px]">
            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground/80">
              <span className="truncate">{indexingStatusMessage || "Scanning workspace files..."}</span>
              {totalFiles > 0 && (
                <span className="shrink-0 font-semibold text-foreground/80">
                  {processedFiles}/{totalFiles}
                </span>
              )}
            </div>
            {totalFiles > 0 && (
              <div className="mt-1.5 h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
