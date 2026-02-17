import React from "react";
import { IconRail } from "./IconRail";
import { ExpandablePanel } from "./ExpandablePanel";
import { FilesPanel } from "./FilesPanel";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { TopBar } from "./TopBar";
import { TitleBar } from "./TitleBar";
import { ChatArea } from "./ChatArea";
import { DocumentViewerPanel } from "./DocumentViewerPanel";
import { ResizeHandle } from "./ResizeHandle";
import { useUIStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { AnimatePresence } from "framer-motion";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ChatView = () => {
  const { activePanel, isDocViewerOpen, docViewerWidth } = useUIStore();
  const {
    currentWorkspace,
    updateWorkspace,
    setIndexingStatusMessage,
    applyIndexingProgressEvent,
    clearIndexingProgress,
  } = useWorkspaceStore();

  React.useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<any>("sidecar-notification", async (event) => {
        const payload = event.payload;
        if (!payload || payload.method !== "indexing.progress") return;

        const message = String(payload?.params?.message || "");
        const progress = payload?.params?.progress;
        if (!message && !progress) return;

        if (message) {
          setIndexingStatusMessage(message);
        }
        if (progress && typeof progress === "object") {
          applyIndexingProgressEvent(progress);
        }

        const lowered = message.toLowerCase();
        const progressType = typeof progress?.type === "string" ? progress.type.toLowerCase() : "";
        const finished =
          progressType === "complete" ||
          progressType === "error" ||
          lowered.includes("scan complete") ||
          lowered.includes("scan failed") ||
          lowered.includes("indexing complete") ||
          lowered.includes("indexing failed");
        updateWorkspace({ isIndexing: !finished });

        if (finished && !disposed) {
          try {
            const workspace = useWorkspaceStore.getState().currentWorkspace;
            if (!workspace) return;
            const { invoke } = await import("@tauri-apps/api/core");
            const status = await invoke<{
              total_count: number;
              indexed_count: number;
              in_progress: boolean;
            }>("get_workspace_status", {
              workspaceId: workspace.id,
            });
            useWorkspaceStore.getState().updateWorkspace({
              indexedCount: status.indexed_count,
              isIndexing: status.in_progress,
            });
            if (!status.in_progress) {
              clearIndexingProgress();
            }
          } catch (error) {
            console.error("Failed to refresh workspace status:", error);
          }
        }
      });
    };

    void setup();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [applyIndexingProgressEvent, clearIndexingProgress, setIndexingStatusMessage, updateWorkspace]);

  React.useEffect(() => {
    if (!isTauri || !currentWorkspace?.isIndexing) return;

    const workspaceId = currentWorkspace.id;
    let disposed = false;

    const syncIndexingStatus = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const status = await invoke<{
          total_count: number;
          indexed_count: number;
          in_progress: boolean;
        }>("get_workspace_status", {
          workspaceId,
        });

        if (disposed) return;
        const state = useWorkspaceStore.getState();
        if (!state.currentWorkspace || state.currentWorkspace.id !== workspaceId) return;

        state.updateWorkspace({
          indexedCount: status.indexed_count,
          isIndexing: status.in_progress,
        });

        if (!status.in_progress) {
          state.setIndexingStatusMessage("Scan complete");
          state.clearIndexingProgress();
          return;
        }

        if (!state.indexingProgress) {
          state.applyIndexingProgressEvent({
            type: "start",
            message: state.indexingStatusMessage || "Scanning workspace files...",
            total_files: status.total_count,
            processed_files: 0,
          });
        }
      } catch (error) {
        if (!disposed) {
          console.error("Failed to sync indexing status:", error);
        }
      }
    };

    void syncIndexingStatus();
    const timerId = window.setInterval(() => {
      void syncIndexingStatus();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [currentWorkspace?.id, currentWorkspace?.isIndexing]);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden font-sans selection:bg-foreground/10">
      {/* Custom Title Bar - Fixed height */}
      <TitleBar />
      
      {/* Main App Content - Takes remaining height */}
      <div className="flex flex-1 w-full min-h-0">
        {/* 1. Icon Rail (Fixed Left) */}
        <IconRail />

        {/* 2. Main Content Area */}
        <div className="flex flex-1 min-h-0 min-w-0 relative">
          {/* 2a. Expandable Panel (Slides in) */}
          <AnimatePresence mode="popLayout">
            {activePanel === "files" && (
              <ExpandablePanel key="files">
                <FilesPanel />
              </ExpandablePanel>
            )}
            {activePanel === "history" && (
              <ExpandablePanel key="history">
                <ChatHistoryPanel />
              </ExpandablePanel>
            )}
          </AnimatePresence>

          {/* 2b. Main View Content (Remaining Space) */}
          <main className="flex-1 flex flex-col min-h-0 min-w-0">
            <TopBar />
            
            <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden relative">
              {/* Document Viewer (Optional) */}
              {isDocViewerOpen && (
                <>
                  <div style={{ width: `${docViewerWidth}%` }} className="flex min-h-0 min-w-0 overflow-hidden">
                    <DocumentViewerPanel />
                  </div>
                  <ResizeHandle />
                </>
              )}

              {/* Chat Area */}
              <div 
                style={{ width: isDocViewerOpen ? `${100 - docViewerWidth}%` : '100%' }}
                className="flex flex-col min-h-0 min-w-0"
              >
                <ChatArea />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
