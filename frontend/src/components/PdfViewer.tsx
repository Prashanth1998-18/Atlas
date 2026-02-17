"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { readWorkspaceFileBytes } from "../lib/workspaceFs";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Dynamically import the PDF wrapper component to avoid SSR issues
const PdfDocumentWrapper = dynamic(
  () => import("./PdfDocumentWrapper"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Initializing PDF viewer...</span>
      </div>
    )
  }
);

interface PdfViewerProps {
  filePath: string;
  onTextSelect?: (text: string, pageNumber: number, x: number, y: number) => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ filePath, onTextSelect }) => {
  const { currentWorkspace } = useWorkspaceStore();
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load PDF file as binary data using Tauri's file system API
  useEffect(() => {
    const loadPdf = async () => {
      if (!filePath) return;
      
      setIsLoading(true);
      setError(null);
      setPdfData(null);
      setCurrentPage(1);
      
      try {
        if (isTauri) {
          if (!currentWorkspace?.id) {
            throw new Error("Workspace not available");
          }
          const fileBytes = await readWorkspaceFileBytes(currentWorkspace.id, filePath);
          setPdfData(fileBytes);
        } else {
          setError("PDF viewing requires Tauri runtime");
        }
      } catch (err) {
        console.error("Failed to load PDF file:", err);
        setError(`Failed to load PDF: ${String(err)}`);
        setIsLoading(false);
      }
    };

    loadPdf();
  }, [filePath, currentWorkspace?.id]);

  const handleDocumentLoadSuccess = useCallback((numPages: number) => {
    setNumPages(numPages);
    setIsLoading(false);
    setError(null);
  }, []);

  const handleDocumentLoadError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setIsLoading(false);
  }, []);

  const memoizedPdfData = useMemo(() => pdfData, [pdfData]);

  const zoomIn = () => setScale((prev) => Math.min(prev + 0.25, 3.0));
  const zoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));

  // Track current page based on scroll position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages === 0) return;

    const pages = container.querySelectorAll('[data-page-number]');
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

    let closestPage = 1;
    let closestDistance = Infinity;

    pages.forEach((page) => {
      const pageRect = page.getBoundingClientRect();
      const pageCenter = pageRect.top + pageRect.height / 2;
      const distance = Math.abs(pageCenter - containerCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = parseInt(page.getAttribute('data-page-number') || '1', 10);
      }
    });

    setCurrentPage(closestPage);
  }, [numPages]);

  // Handle right-click for context menu (same as other doc types)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    
    if (text && text.length > 0 && onTextSelect) {
      e.preventDefault();
      // Find the page number from the closest parent with data-page-number
      let pageNum = currentPage;
      let element = e.target as HTMLElement | null;
      while (element && element !== scrollContainerRef.current) {
        const pageAttr = element.getAttribute('data-page-number');
        if (pageAttr) {
          pageNum = parseInt(pageAttr, 10);
          break;
        }
        element = element.parentElement;
      }
      onTextSelect(text, pageNum, e.clientX, e.clientY);
    }
  }, [currentPage, onTextSelect]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-destructive mb-4">
          <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-destructive mb-2">Failed to load PDF</h3>
        <p className="text-xs text-muted-foreground max-w-md">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-muted/20">
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-background/80 border-b border-border/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Page {currentPage} of {numPages || "..."}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs font-medium min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 3.0}
            className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      {/* PDF Content - continuous scroll through all pages */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto custom-scrollbar p-4 select-text min-h-0"
        onContextMenu={handleContextMenu}
        onScroll={handleScroll}
      >
        <div className="flex flex-col items-center">
          {memoizedPdfData ? (
            <PdfDocumentWrapper
              pdfData={memoizedPdfData}
              numPages={numPages}
              scale={scale}
              onLoadSuccess={handleDocumentLoadSuccess}
              onLoadError={handleDocumentLoadError}
            />
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Loading PDF...</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
