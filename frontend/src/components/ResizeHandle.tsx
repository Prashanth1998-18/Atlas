import React, { useState, useEffect, useCallback } from "react";
import { GripVertical } from "lucide-react";
import { useUIStore } from "../store/uiStore";

export const ResizeHandle: React.FC = () => {
  const { docViewerWidth, setDocViewerWidth } = useUIStore();
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = (e.clientX / window.innerWidth) * 100;
        setDocViewerWidth(newWidth);
      }
    },
    [isResizing, setDocViewerWidth]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "default";
    }

    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "default";
    };
  }, [isResizing, resize, stopResizing]);

  return (
    <div
      onMouseDown={startResizing}
      className={`w-1.5 h-full hover:bg-primary/30 transition-colors cursor-col-resize flex items-center justify-center group relative z-50 ${isResizing ? 'bg-primary/40' : 'bg-transparent'}`}
    >
      <div className={`w-[1px] h-12 bg-border group-hover:bg-primary/50 ${isResizing ? 'bg-primary' : ''}`} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical size={12} className="text-primary/50" />
      </div>
    </div>
  );
};
