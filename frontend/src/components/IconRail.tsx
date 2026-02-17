import React, { useEffect, useState } from "react";
import { Plus, FolderOpen, Files, History, Settings, Loader2 } from "lucide-react";
import { useUIStore, ActivePanel } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { SettingsModal } from "./SettingsModal";
import { useConversationStore } from "../store/conversationStore";
import { useChatStore } from "../store/chatStore";

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

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick: () => void;
  tooltip?: string;
  disabled?: boolean;
  loading?: boolean;
}

const NavItem = ({ icon: Icon, label, active, onClick, tooltip, disabled, loading }: NavItemProps) => {
  return (
    <div className="relative group flex items-center justify-center w-full py-2">
      <motion.button
        whileHover={disabled ? {} : { scale: 1.05 }}
        whileTap={disabled ? {} : { scale: 0.95 }}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={cn(
          "relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300",
          active 
            ? "bg-accent text-foreground" 
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {loading ? (
          <Loader2 size={20} strokeWidth={2} className="animate-spin" />
        ) : (
          <Icon size={20} strokeWidth={2} />
        )}
        {active && !loading && (
          <motion.div
            layoutId="active-indicator"
            className="absolute -left-3 w-1 h-6 bg-foreground rounded-r-full"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
      </motion.button>
      
      {/* Tooltip */}
      <div className="absolute left-14 px-2 py-1 bg-popover text-popover-foreground text-[11px] font-medium rounded border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
        {tooltip || label}
      </div>
    </div>
  );
};

export const IconRail = () => {
  const { activePanel, setActivePanel, setDocViewerOpen } = useUIStore();
  const { setWorkspace, setWorkspaceReady } = useWorkspaceStore();
  const { clearDocument, clearSelections } = useDocumentStore();
  const { setCurrentConversationId, clearConversations } = useConversationStore();
  const { setInputValue, clearPinnedDocs } = useChatStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);

  const handleOpenWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
      });
      
      if (selected && typeof selected === 'string') {
        // Show loading state
        setIsOpeningWorkspace(true);
        setWorkspaceReady(false);
        
        // Clear current conversation state before switching
        setCurrentConversationId(null);
        clearConversations();
        setInputValue("");
        clearPinnedDocs();
        
        // Clear document viewer state
        clearDocument();
        clearSelections();
        setDocViewerOpen(false);
        
        const info = await invokeOpenWorkspace(selected);
        
        setWorkspace({
          id: info.workspace_id,
          path: selected,
          name: selected.split(/[/\\]/).pop() || selected,
          documentCount: info.document_count,
          indexedCount: info.indexed_count,
          isIndexing: info.is_indexing,
        });
        
        setIsOpeningWorkspace(false);
      }
    } catch (error) {
      console.error("Failed to open workspace:", error);
      setIsOpeningWorkspace(false);
    }
  };

  const handleNewChat = () => {
    setCurrentConversationId(null);
    setInputValue("");
    clearPinnedDocs();
    setActivePanel(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        if (!isOpeningWorkspace) handleNewChat();
        return;
      }

      if (key === "o") {
        event.preventDefault();
        if (!isOpeningWorkspace) {
          void handleOpenWorkspace();
        }
        return;
      }

      if (key === "b") {
        event.preventDefault();
        if (!isOpeningWorkspace && activePanel !== "files") {
          setActivePanel("files");
        }
        return;
      }

      if (key === "h") {
        event.preventDefault();
        if (!isOpeningWorkspace && activePanel !== "history") {
          setActivePanel("history");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel, isOpeningWorkspace, setActivePanel]);

  return (
    <>
      <aside className="w-16 h-full flex flex-col items-center py-4 bg-background border-r border-border/50 z-30 shrink-0">
      {/* Top Section */}
        <div className="flex flex-col items-center w-full space-y-2 flex-1">
          <NavItem 
          icon={Plus} 
            label="New Chat" 
            onClick={handleNewChat} 
            tooltip="New Chat (Ctrl+N)"
            disabled={isOpeningWorkspace}
        />
          <div className="w-8 h-px bg-border/50 my-1" />
          <NavItem 
          icon={FolderOpen} 
            label="Open Workspace" 
            onClick={handleOpenWorkspace} 
            tooltip="Open Workspace (Ctrl+O)"
            loading={isOpeningWorkspace}
            disabled={isOpeningWorkspace}
        />
          <NavItem 
          icon={Files} 
            label="Files" 
          active={activePanel === "files"}
            onClick={() => setActivePanel("files")} 
            tooltip="Files (Ctrl+B)"
            disabled={isOpeningWorkspace}
        />
          <NavItem 
            icon={History} 
            label="Chat History" 
          active={activePanel === "history"}
            onClick={() => setActivePanel("history")} 
            tooltip="Chat History (Ctrl+H)"
            disabled={isOpeningWorkspace}
        />
      </div>

      {/* Bottom Section */}
        <div className="flex flex-col items-center w-full space-y-2">
          <NavItem 
          icon={Settings} 
            label="Settings" 
            onClick={() => setIsSettingsOpen(true)} 
          tooltip="Settings" 
        />
      </div>
      </aside>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </>
  );
};


