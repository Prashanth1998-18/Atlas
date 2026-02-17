import React from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";
import { cn } from "../lib/utils";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const TitleBar = () => {
  const [isMaximized, setIsMaximized] = React.useState(false);

  const handleMinimize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) {
      await win.unmaximize();
      setIsMaximized(false);
    } else {
      await win.maximize();
      setIsMaximized(true);
    }
  };

  const handleClose = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  // Check initial maximized state
  React.useEffect(() => {
    const checkMaximized = async () => {
      if (!isTauri) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();
  }, []);

  return (
    <div 
      data-tauri-drag-region 
      className="h-9 flex items-center justify-between bg-[#0d0d0d] border-b border-border select-none shrink-0"
    >
      {/* Left: App Icon & Name */}
      <div 
        data-tauri-drag-region 
        className="flex items-center gap-2.5 px-4 h-full"
      >
        <div className="w-4 h-4 rounded bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
          <span className="text-[8px] font-black text-primary-foreground">A</span>
        </div>
        <span 
          data-tauri-drag-region 
          className="text-[11px] font-semibold text-muted-foreground tracking-wide"
        >
          ATLAS
        </span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="h-full px-4 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors"
          title="Minimize"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-4 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Square size={11} strokeWidth={1.5} />
          ) : (
            <Maximize2 size={12} strokeWidth={1.5} />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 flex items-center justify-center text-muted-foreground/60 hover:text-white hover:bg-red-500 transition-colors"
          title="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};
