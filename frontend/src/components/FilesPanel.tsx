import React, { useEffect, useState } from "react";
import { File, RefreshCw, FileText, Table, FileCode, FolderOpen } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUIStore } from "../store/uiStore";
import { useDocumentStore } from "../store/documentStore";
import { PanelHeader } from "./ExpandablePanel";
import { cn } from "../lib/utils";
import { listWorkspaceDirectory } from "../lib/workspaceFs";
import { motion } from "framer-motion";

interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.md', '.markdown', '.txt', '.csv', '.xlsx', '.xls'];
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.atlas', '__pycache__', '.venv', 'target', 'dist', 'build']);

const getFileTypeColor = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'text-red-500';
    case 'xlsx':
    case 'xls':
    case 'csv': return 'text-green-500';
    case 'docx':
    case 'doc': return 'text-blue-500';
    case 'md':
    case 'markdown': return 'text-purple-500';
    default: return 'text-slate-400';
  }
};

const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return FileText;
    case 'xlsx':
    case 'xls':
    case 'csv': return Table;
    case 'docx':
    case 'doc': return FileText;
    case 'md':
    case 'markdown': return FileCode;
    default: return File;
  }
};

export const FilesPanel = () => {
  const { currentWorkspace, indexingStatusMessage, indexingProgress, setWorkspace, setWorkspaceReady } = useWorkspaceStore();
  const { setActivePanel, setDocViewerOpen } = useUIStore();
  const { setLoading, setContent, setError: setDocError, clearDocument, clearSelections } = useDocumentStore();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const totalFiles = indexingProgress?.totalFiles || 0;
  const processedFiles = Math.min(indexingProgress?.processedFiles || 0, totalFiles || 0);
  const overallProgress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
  const progressRows = [...(indexingProgress?.files || [])]
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return a.name.localeCompare(b.name);
    });

  const loadDocumentPreview = async (filePath: string, fileName: string) => {
    if (!currentWorkspace || !isTauri) return;

    try {
      setLoading(filePath, fileName);
      setDocViewerOpen(true);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_preview_path", { path: filePath });
      const result = await invoke<{
        content: string;
        file_type: string;
        filename: string;
        can_preview: boolean;
      }>("get_preview_content");
      setContent(result.content, result.file_type);
    } catch (err: unknown) {
      console.error("Failed to load document preview:", err);
      setDocError(`IO_EXCEPTION: ${String(err)}`);
    }
  };

  const loadFiles = async () => {
    if (!currentWorkspace || !isTauri) return;
    setIsRefreshing(true);
    
    try {
      const rootPath = currentWorkspace.path;
      const workspaceId = currentWorkspace.id;
      const fileList: FileEntry[] = [];

      // Recursively scan directories
      async function scanDir(dirPath: string, depth: number = 0): Promise<void> {
        if (depth > 5) return;
        try {
          const entries = await listWorkspaceDirectory(workspaceId, dirPath);
          for (const entry of entries) {
            if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
            const fullPath = entry.path;
            const relativePath = fullPath.replace(rootPath, '').replace(/^[/\\]+/, '');
            
            if (entry.is_directory) {
              await scanDir(fullPath, depth + 1);
            } else if (entry.is_file) {
              const ext = '.' + entry.name.split('.').pop()?.toLowerCase();
              if (SUPPORTED_EXTENSIONS.includes(ext)) {
                fileList.push({
                  name: entry.name,
                  path: fullPath,
                  relativePath,
                  type: entry.name.split('.').pop()?.toLowerCase() || 'unknown'
                });
              }
            }
          }
        } catch (err) {
          // Skip directories we can't read
        }
      }

      await scanDir(rootPath);
      setFiles(fileList.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

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

  const handleRefresh = async () => {
    if (!currentWorkspace || !isTauri) return;
    setIsRefreshing(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Re-open workspace to ensure sidecar is running and trigger reindex
      const info = await invoke<{
        workspace_id: string;
        document_count: number;
        indexed_count: number;
        is_indexing: boolean;
      }>("open_workspace", { path: currentWorkspace.path });
      
      // Update workspace store with fresh data
      const { useWorkspaceStore } = await import("../store/workspaceStore");
      useWorkspaceStore.getState().setWorkspace({
        id: info.workspace_id,
        path: currentWorkspace.path,
        name: currentWorkspace.name,
        documentCount: info.document_count,
        indexedCount: info.indexed_count,
        isIndexing: info.is_indexing,
      });
      
      await loadFiles();
      
      // Dispatch event to notify ChatPanel that files refresh is complete
      window.dispatchEvent(new CustomEvent('files-refreshed'));
    } catch (error) {
      console.error("Failed to reindex:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [currentWorkspace?.path]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader 
        title="Files" 
        onClose={() => setActivePanel(null)}
      >
        <button 
          onClick={handleRefresh}
          className={cn(
            "p-1.5 hover:bg-accent rounded-md transition-all text-muted-foreground",
            isRefreshing && "animate-spin text-foreground"
          )}
        >
          <RefreshCw size={14} />
        </button>
      </PanelHeader>

      {currentWorkspace?.isIndexing && (
        <div className="mx-2 mt-2 px-3 py-2.5 border border-border/50 bg-secondary/40 rounded-lg space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Scanning in progress
            </p>
            {totalFiles > 0 && (
              <span className="text-[10px] font-semibold text-foreground/80">
                {processedFiles}/{totalFiles}
              </span>
            )}
          </div>

          <p className="text-xs text-foreground/80 break-words">
            {indexingStatusMessage || "Scanning workspace files..."}
          </p>

          {totalFiles > 0 && (
            <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          )}

          {progressRows.length > 0 && (
            <div className="space-y-1.5 pt-0.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {progressRows.map((row) => {
                const barColor =
                  row.status === "error"
                    ? "bg-red-500/80"
                    : row.status === "skipped"
                      ? "bg-muted-foreground/50"
                      : "bg-primary";

                return (
                  <div key={row.path} className="px-2 py-1.5 rounded-md border border-border/40 bg-background/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-foreground/90 truncate">
                        {row.index}. {row.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {Math.round(row.progress)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-border/50 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ease-out ${barColor}`}
                        style={{ width: `${Math.max(0, Math.min(100, row.progress))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
        {!currentWorkspace ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FolderOpen size={40} className="mb-4 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium mb-1">No workspace is open</p>
            <p className="text-xs text-muted-foreground mb-4">Open a workspace to view files</p>
            <button
              onClick={handleOpenWorkspace}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Open Workspace
            </button>
          </div>
        ) : isRefreshing && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 p-8 text-center">
            <div className="flex gap-1 mb-2">
              <div className="w-1.5 h-4 bg-muted-foreground/40 rounded animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-4 bg-muted-foreground/40 rounded animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-4 bg-muted-foreground/40 rounded animate-bounce" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scanning files...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-50">
            <File size={32} className="mb-2" />
            <p className="text-xs">No supported files found</p>
            <p className="text-[10px] text-muted-foreground mt-1">PDF, DOCX, MD, TXT, CSV, XLSX</p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {files.map((file, i) => {
              const Icon = getFileIcon(file.name);
              const colorClass = getFileTypeColor(file.name);
              
              return (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.01, 0.3) }}
                  key={file.path}
                  className="group flex flex-col px-3 py-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-all border border-transparent hover:border-border/50"
                  onClick={() => loadDocumentPreview(file.path, file.name)}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={cn("flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-background border border-border/50 group-hover:border-border group-hover:shadow-sm transition-all", colorClass)}>
                      <Icon size={16} strokeWidth={2.5} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13px] font-medium truncate group-hover:text-foreground transition-colors">
                        {file.name}
                      </span>
                      {(file.relativePath.includes('/') || file.relativePath.includes('\\')) && file.relativePath !== file.name ? (
                        <span className="text-[10px] text-muted-foreground/60 truncate font-mono">
                          {file.relativePath.split(/[/\\]/).slice(0, -1).join(' / ')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
