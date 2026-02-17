import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Workspace {
  id: string;
  path: string;
  name: string;
  documentCount: number;
  indexedCount: number;
  isIndexing: boolean;
}

export type IndexingFileStatus = "processing" | "done" | "skipped" | "error";

export interface IndexingFileProgress {
  path: string;
  name: string;
  index: number;
  total: number;
  progress: number;
  status: IndexingFileStatus;
  stage: string;
}

export interface IndexingProgress {
  totalFiles: number;
  processedFiles: number;
  indexed: number;
  updated: number;
  deleted: number;
  skipped: number;
  files: IndexingFileProgress[];
}

export interface IndexingProgressEvent {
  type?: string;
  message?: string;
  total_files?: number;
  processed_files?: number;
  indexed?: number;
  updated?: number;
  deleted?: number;
  skipped?: number;
  file?: {
    path?: string;
    index?: number;
    total?: number;
    progress?: number;
    status?: IndexingFileStatus;
    stage?: string;
  };
}

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  recentWorkspaces: Workspace[];
  isWorkspaceReady: boolean; // Flag to indicate workspace is fully opened on backend
  indexingStatusMessage: string | null;
  indexingProgress: IndexingProgress | null;
  
  // Actions
  setWorkspace: (workspace: Workspace | null) => void;
  setWorkspaceReady: (ready: boolean) => void;
  updateWorkspace: (updates: Partial<Workspace>) => void;
  setIndexingStatusMessage: (message: string | null) => void;
  applyIndexingProgressEvent: (event: IndexingProgressEvent) => void;
  clearIndexingProgress: () => void;
  addRecentWorkspace: (workspace: Workspace) => void;
  clearRecentWorkspaces: () => void;
}

const clampProgress = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
};

const isValidStatus = (value: unknown): value is IndexingFileStatus =>
  value === "processing" || value === "done" || value === "skipped" || value === "error";

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
  currentWorkspace: null,
      recentWorkspaces: [],
      isWorkspaceReady: false,
      indexingStatusMessage: null,
      indexingProgress: null,
      
      setWorkspace: (workspace) => {
        set((state) => {
          const isSameWorkspace = Boolean(
            workspace &&
            state.currentWorkspace &&
            state.currentWorkspace.id === workspace.id
          );

          const shouldPreserveProgress =
            Boolean(workspace?.isIndexing) &&
            isSameWorkspace &&
            Boolean(state.indexingProgress);

          return {
            currentWorkspace: workspace,
            isWorkspaceReady: !!workspace,
            indexingStatusMessage: workspace?.isIndexing
              ? (isSameWorkspace && state.indexingStatusMessage
                  ? state.indexingStatusMessage
                  : "Scanning workspace files...")
              : null,
            indexingProgress: workspace?.isIndexing
              ? (shouldPreserveProgress
                  ? state.indexingProgress
                  : {
                      totalFiles: workspace.documentCount,
                      processedFiles: 0,
                      indexed: 0,
                      updated: 0,
                      deleted: 0,
                      skipped: 0,
                      files: [],
                    })
              : null,
          };
        });
        if (workspace) {
          set((state) => {
            const filtered = state.recentWorkspaces.filter(w => w.path !== workspace.path);
            return {
              recentWorkspaces: [workspace, ...filtered].slice(0, 5)
            };
          });
        }
      },
      
      setWorkspaceReady: (ready) => set({ isWorkspaceReady: ready }),
      
  updateWorkspace: (updates) =>
    set((state) => ({
      currentWorkspace: state.currentWorkspace
        ? { ...state.currentWorkspace, ...updates }
        : null,
    })),

      setIndexingStatusMessage: (message) => set({ indexingStatusMessage: message }),
      applyIndexingProgressEvent: (event) =>
        set((state) => {
          const isStart = event.type === "start";
          const base =
            isStart || !state.indexingProgress
              ? {
                  totalFiles: Number.isFinite(Number(event.total_files)) ? Number(event.total_files) : 0,
                  processedFiles: Number.isFinite(Number(event.processed_files)) ? Number(event.processed_files) : 0,
                  indexed: Number.isFinite(Number(event.indexed)) ? Number(event.indexed) : 0,
                  updated: Number.isFinite(Number(event.updated)) ? Number(event.updated) : 0,
                  deleted: Number.isFinite(Number(event.deleted)) ? Number(event.deleted) : 0,
                  skipped: Number.isFinite(Number(event.skipped)) ? Number(event.skipped) : 0,
                  files: [],
                }
              : { ...state.indexingProgress, files: [...state.indexingProgress.files] };

          if (Number.isFinite(Number(event.total_files))) base.totalFiles = Number(event.total_files);
          if (Number.isFinite(Number(event.processed_files))) base.processedFiles = Number(event.processed_files);
          if (Number.isFinite(Number(event.indexed))) base.indexed = Number(event.indexed);
          if (Number.isFinite(Number(event.updated))) base.updated = Number(event.updated);
          if (Number.isFinite(Number(event.deleted))) base.deleted = Number(event.deleted);
          if (Number.isFinite(Number(event.skipped))) base.skipped = Number(event.skipped);

          const filePath = event.file?.path;
          if (filePath) {
            const existingIndex = base.files.findIndex((f) => f.path === filePath);
            const existing = existingIndex >= 0 ? base.files[existingIndex] : null;
            const nextFile: IndexingFileProgress = {
              path: filePath,
              name: filePath.split(/[\\/]/).pop() || filePath,
              index: Number.isFinite(Number(event.file?.index))
                ? Number(event.file?.index)
                : existing?.index ?? base.processedFiles + 1,
              total: Number.isFinite(Number(event.file?.total))
                ? Number(event.file?.total)
                : existing?.total ?? base.totalFiles,
              progress:
                event.file?.progress !== undefined
                  ? clampProgress(event.file.progress)
                  : existing?.progress ?? 0,
              status: isValidStatus(event.file?.status) ? event.file.status : existing?.status ?? "processing",
              stage:
                typeof event.file?.stage === "string"
                  ? event.file.stage
                  : existing?.stage ?? "",
            };

            if (existingIndex >= 0) {
              base.files[existingIndex] = nextFile;
            } else {
              base.files.push(nextFile);
            }
          }

          base.files.sort((a, b) => {
            if (a.index !== b.index) return a.index - b.index;
            return a.name.localeCompare(b.name);
          });

          return { indexingProgress: base };
        }),
      clearIndexingProgress: () => set({ indexingProgress: null }),
        
      addRecentWorkspace: (workspace) => set((state) => {
        const filtered = state.recentWorkspaces.filter(w => w.path !== workspace.path);
        return {
          recentWorkspaces: [workspace, ...filtered].slice(0, 5)
        };
      }),
      
      clearRecentWorkspaces: () => set({ recentWorkspaces: [] }),
    }),
    {
      name: "atlas-workspace-storage",
      storage: createJSONStorage(() => localStorage),
      // Only persist recent workspaces - always start fresh with no workspace open
      partialize: (state) => ({ 
        recentWorkspaces: state.recentWorkspaces 
      }),
      // On hydration, only restore recentWorkspaces, ignore any old currentWorkspace
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        recentWorkspaces: persistedState?.recentWorkspaces || [],
        // Explicitly keep currentWorkspace as null on startup
        currentWorkspace: null,
        isWorkspaceReady: false,
      }),
    }
  )
);
