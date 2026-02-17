"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import * as docx from "docx-preview";
import { useWorkspaceStore } from "../store/workspaceStore";
import { readWorkspaceFileBytes } from "../lib/workspaceFs";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface DocxViewerProps {
  filePath: string;
  onTextSelect?: (text: string, x: number, y: number) => void;
}

export const DocxViewer: React.FC<DocxViewerProps> = ({ filePath, onTextSelect }) => {
  const { currentWorkspace } = useWorkspaceStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const styleContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDocx = async () => {
      if (!filePath || !containerRef.current) {
        console.warn('[DocxViewer] Missing filePath or containerRef');
        return;
      }

      setIsLoading(true);
      setError(null);

      // Clear previous content
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      if (styleContainerRef.current) {
        styleContainerRef.current.innerHTML = "";
      }

      try {
        if (!isTauri) {
          setError("DOCX viewing requires Tauri runtime");
          setIsLoading(false);
          return;
        }

        if (!currentWorkspace?.id) {
          throw new Error("Workspace not available");
        }
        const fileBytes = await readWorkspaceFileBytes(currentWorkspace.id, filePath);

        // Convert to ArrayBuffer for docx-preview
        const arrayBuffer = fileBytes.buffer.slice(
          fileBytes.byteOffset,
          fileBytes.byteOffset + fileBytes.byteLength
        );

        // Render the DOCX document
        await docx.renderAsync(
          arrayBuffer,
          containerRef.current!,
          styleContainerRef.current || containerRef.current,
          {
            className: "docx",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            renderChanges: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            renderComments: false,
            renderAltChunks: true,
            debug: false,
          }
        );

        setIsLoading(false);
      } catch (err) {
        console.error("Failed to load DOCX file:", err);
        setError(`Failed to load DOCX: ${String(err)}`);
        setIsLoading(false);
      }
    };

    loadDocx();
  }, [filePath, currentWorkspace?.id]);

  // Handle text selection for context menu
  useEffect(() => {
    if (!containerRef.current || !onTextSelect || isLoading) return;

    const handleContextMenu = (e: MouseEvent) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (text && text.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onTextSelect(text, e.clientX, e.clientY);
      }
    };

    const container = containerRef.current;
    container.addEventListener("contextmenu", handleContextMenu);

    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [onTextSelect, isLoading]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-destructive mb-4">
          <AlertCircle className="w-16 h-16 mx-auto" />
        </div>
        <h3 className="text-sm font-bold text-destructive mb-2">Failed to load DOCX</h3>
        <p className="text-xs text-muted-foreground max-w-md">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-background overflow-hidden">
      {/* Style container for docx-preview styles - must be visible for styles to apply */}
      <div ref={styleContainerRef} style={{ display: 'none' }} />

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Loading DOCX...</span>
        </div>
      )}

      {/* Document content - scrollable container */}
      <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
        <div
          ref={containerRef}
          className="p-6 select-text"
        />
      </div>
    </div>
  );
};
