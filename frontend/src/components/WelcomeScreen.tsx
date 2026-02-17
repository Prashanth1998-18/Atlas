import { useState, ReactNode } from "react";
import { FolderOpen, Settings, Terminal, Shield, Cpu, Zap } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { SettingsModal } from "./SettingsModal";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invokeOpenWorkspace(path: string): Promise<{
  workspace_id: string;
  document_count: number;
  indexed_count: number;
  is_indexing: boolean;
}> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Opening workspace timed out. Please try again."));
    }, 30000);

    invoke<{
      workspace_id: string;
      document_count: number;
      indexed_count: number;
      is_indexing: boolean;
    }>("open_workspace", { path })
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

export default function WelcomeScreen(): ReactNode {
  const [isOpening, setIsOpening] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const { setWorkspace } = useWorkspaceStore();

  async function handleOpenFolder(): Promise<void> {
    if (!isTauri) {
      alert("Please run this app in the Tauri window, not in a browser.");
      return;
    }

    try {
      setIsOpening(true);
      setStatusMessage("INITIALIZING FOLDER PICKER...");

      const { open } = await import("@tauri-apps/plugin-dialog");
      
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "SELECT WORKSPACE",
      });

      if (!selectedPath || typeof selectedPath !== "string") {
        setIsOpening(false);
        setStatusMessage(null);
        return;
      }

      setStatusMessage("VALIDATING PERMISSIONS...");
      setStatusMessage("SCANNING LOCAL ASSETS...");

      const result = await invokeOpenWorkspace(selectedPath);
      
      setWorkspace({
        id: result.workspace_id,
        path: selectedPath,
        name: selectedPath.split(/[/\\]/).pop() || "WORKSPACE",
        documentCount: result.document_count,
        indexedCount: result.indexed_count,
        isIndexing: result.is_indexing,
      });

      setStatusMessage(null);
    } catch (error: unknown) {
      console.error("Failed to open workspace:", error);
      alert(`SYSTEM ERROR: ${error}`);
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-background text-foreground relative overflow-hidden scanline">
      {/* Background patterns */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
      
      <div className="text-left space-y-12 max-w-2xl p-12 border border-primary/20 bg-card/60 backdrop-blur-md relative z-10 shadow-2xl">
        {/* Decorative corner brackets */}
        <div className="absolute -top-1 -left-1 w-8 h-8 border-t-2 border-l-2 border-primary" />
        <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-2 border-r-2 border-primary" />
        
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-primary">
            <Terminal className="w-6 h-6" />
            <span className="text-xs font-bold tracking-[0.3em] uppercase">System Node v1.0.0</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-7xl font-black tracking-tight flex items-baseline gap-2">
              ATLAS<span className="w-3 h-3 bg-primary animate-pulse" />
            </h1>
            <p className="text-muted-foreground text-sm font-medium tracking-wide max-w-md uppercase leading-relaxed opacity-70">
              Local-first intelligence for technical document analysis and knowledge synthesis.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <button
            onClick={handleOpenFolder}
            disabled={isOpening}
            className="group relative flex items-center justify-between w-full px-6 py-5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <div className="flex items-center gap-4">
              <FolderOpen className="w-5 h-5" />
              <span className="text-sm font-bold tracking-widest uppercase">
                {isOpening ? "SYSTEM_SCAN_IN_PROGRESS" : "LOAD_WORKSPACE_FOLDER"}
              </span>
            </div>
            <span className="text-xs opacity-50 font-mono">[CMD+O]</span>
          </button>

          {statusMessage && (
            <div className="flex items-center gap-3 px-2">
              <div className="flex gap-1">
                <div className="w-1 h-3 bg-primary animate-[bounce_1s_infinite_0ms]" />
                <div className="w-1 h-3 bg-primary animate-[bounce_1s_infinite_200ms]" />
                <div className="w-1 h-3 bg-primary animate-[bounce_1s_infinite_400ms]" />
              </div>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">{statusMessage}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-8 pt-10 border-t border-primary/10">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary/60">
              <Shield className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Security</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed uppercase">100% Offline processing. No telemetry.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary/60">
              <Cpu className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Compute</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed uppercase">High-performance vector search with LanceDB.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary/60">
              <Zap className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Efficiency</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed uppercase">Instant file scanning and semantic retrieval.</p>
          </div>
        </div>
      </div>

      {/* Settings button - top right */}
      <button
        onClick={() => setShowSettings(true)}
        className="absolute top-8 right-8 p-3 text-muted-foreground hover:text-primary hover:border-primary border border-transparent rounded-none transition-all z-20"
        title="SETTINGS"
      >
        <Settings className="w-5 h-5" />
      </button>
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}
