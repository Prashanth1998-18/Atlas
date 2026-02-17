import React, { ReactNode, useRef, useState } from "react";
import { X, FileText, FileCode, FileType, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDocumentStore } from "../store/documentStore";
import { useUIStore } from "../store/uiStore";
import { SelectionContextMenu } from "./SelectionContextMenu";
import { PdfViewer } from "./PdfViewer";
import { DocxViewer } from "./DocxViewer";
import { MonacoEditorViewer } from "./MonacoEditorViewer";

export const DocumentViewerPanel: React.FC = () => {
  const { selectedDocument, addSelection } = useDocumentStore();
  const { setDocViewerOpen } = useUIStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, selection: string } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectionText = selection?.toString();
    
    if (selectionText && selectionText.trim()) {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        selection: selectionText
      });
    }
  };

  const handleAddSelection = (text: string, pageNumber?: number) => {
    if (!selectedDocument) return;

    let lines: [number, number] | undefined;
    let page: number | undefined = pageNumber;

    if (selectedDocument.fileType === "txt" || selectedDocument.fileType === "json") {
      // Simple line calculation for text files
      const fullContent = selectedDocument.content;
      const startIndex = fullContent.indexOf(text);
      if (startIndex !== -1) {
        const textBefore = fullContent.substring(0, startIndex);
        const startLine = textBefore.split("\n").length;
        const selectionLines = text.split("\n").length;
        lines = [startLine, startLine + selectionLines - 1];
      }
    } else if (selectedDocument.fileType === "pdf" && !pageNumber) {
      // Find page number by looking for "## Page X" markers in the content (fallback for text-based rendering)
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        let currentNode = selection.anchorNode.parentElement;
        while (currentNode && currentNode !== contentRef.current) {
          const pageMarker = currentNode.previousElementSibling;
          if (pageMarker?.textContent?.includes("PAGE_")) {
            const pageNum = parseInt(pageMarker.textContent.replace("PAGE_", ""));
            if (!isNaN(pageNum)) {
              page = pageNum;
              break;
            }
          }
          currentNode = currentNode.parentElement;
        }
      }
    }

    // Add selected text directly to chat input (not pin the document)
    window.dispatchEvent(new CustomEvent('add-selection-to-chat', {
      detail: {
        text,
        filename: selectedDocument.filename,
        path: selectedDocument.path,
        lines,
        page
      }
    }));
  };

  // Handler for PDF text selection (triggered on right-click)
  const handlePdfTextSelect = (text: string, pageNumber: number, x: number, y: number) => {
    setContextMenu({
      x,
      y,
      selection: text
    });
    // Store the page number for when "Add to Chat" is clicked
    setPdfSelectionPage(pageNumber);
  };

  // Handler for DOCX text selection (triggered on right-click)
  const handleDocxTextSelect = (text: string, x: number, y: number) => {
    setContextMenu({
      x,
      y,
      selection: text
    });
  };

  // Handler for Monaco editor text selection (triggered on right-click)
  const handleMonacoTextSelect = (text: string, x: number, y: number) => {
    setContextMenu({
      x,
      y,
      selection: text
    });
  };

  const [pdfSelectionPage, setPdfSelectionPage] = useState<number | undefined>(undefined);

  if (!selectedDocument) return null;

  const renderLineNumbers = (content: string) => {
    const lines = content.split("\n");
    return (
      <div className="select-none text-right pr-4 text-muted-foreground/30 font-mono text-[11px] leading-relaxed border-r border-border/50 mr-4">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
    );
  };


  const renderContent = () => {
    const { content, fileType, path, filename } = selectedDocument;
    
    // Normalize fileType to lowercase for case-insensitive matching
    const normalizedFileType = fileType?.toLowerCase().trim() || '';
    
    // Check if file extension matches DOCX (multiple fallback checks)
    const pathLower = path?.toLowerCase() || '';
    const filenameLower = filename?.toLowerCase() || '';
    const isDocxByExtension = 
      pathLower.endsWith('.docx') || 
      pathLower.endsWith('.doc') ||
      filenameLower.endsWith('.docx') ||
      filenameLower.endsWith('.doc');
    
    // Handle DOCX files FIRST - check both fileType and file extension
    // This must come before other file type checks to ensure proper routing
    if (normalizedFileType === "docx" || normalizedFileType === "doc" || isDocxByExtension) {
      // Use docx-preview for proper DOCX rendering - always use file path, not extracted content
      if (!path) {
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Error: File path not available</p>
          </div>
        );
      }
      return (
        <DocxViewer 
          filePath={path} 
          onTextSelect={handleDocxTextSelect}
        />
      );
    }
    
    // Use Monaco Editor for text files and code files
    const codeFileExtensions = ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'yaml', 'yml', 'xml', 'html', 'css', 'scss', 'sass', 'less', 'sql', 'r', 'lua', 'pl', 'log', 'ini', 'conf', 'config'];
    const isCodeFile = 
      fileType === "txt" || fileType === "json" || 
      normalizedFileType === "txt" || normalizedFileType === "json" ||
      codeFileExtensions.some(ext => pathLower.endsWith(`.${ext}`)) ||
      codeFileExtensions.some(ext => filenameLower.endsWith(`.${ext}`));
    
    if (isCodeFile) {
      return (
        <MonacoEditorViewer
          content={content}
          filePath={path}
          language={normalizedFileType === "json" ? "json" : undefined}
          onTextSelect={handleMonacoTextSelect}
        />
      );
    }

    switch (normalizedFileType) {
      case "md":
      case "markdown":
        return (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-bold mt-8 mb-4 text-foreground">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold mt-8 mb-3 text-foreground border-b border-border pb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold mt-6 mb-2 text-foreground">{children}</h3>,
                h4: ({ children }) => <h4 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h4>,
                h5: ({ children }) => <h5 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h5>,
                h6: ({ children }) => <h6 className="text-sm font-medium mt-2 mb-1 text-foreground/80">{children}</h6>,
                p: ({ children }) => <p className="text-foreground/80 text-sm leading-relaxed mb-4 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1 text-foreground/80 text-sm">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-1 text-foreground/80 text-sm">{children}</ol>,
                li: ({ children }) => <li className="text-foreground/80 leading-relaxed">{children}</li>,
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  if (isInline) {
                    return <code className="px-1.5 py-0.5 bg-secondary text-foreground text-xs font-mono rounded break-words" {...props}>{children}</code>;
                  }
                  return (
                    <code className={`${className} block whitespace-pre-wrap break-words`} {...props}>
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-secondary/50 border border-border/50 p-4 my-4 overflow-x-auto text-xs font-mono rounded-xl max-w-full whitespace-pre-wrap break-words">
                    {children}
                  </pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-border pl-4 my-4 italic text-foreground/70">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a href={href} className="text-primary hover:underline break-words" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                hr: () => <hr className="my-6 border-border" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-border/50 rounded-lg">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-secondary/50">{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr className="border-b border-border/50">{children}</tr>,
                th: ({ children }) => <th className="px-4 py-2 text-left text-sm font-semibold text-foreground border border-border/50">{children}</th>,
                td: ({ children }) => <td className="px-4 py-2 text-sm text-foreground/80 border border-border/50">{children}</td>,
                img: ({ src, alt }) => (
                  <img src={src} alt={alt} className="max-w-full h-auto rounded-lg my-4" />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        );
      case "pdf":
        // Use the native PDF viewer for proper rendering
        // The PDF viewer handles its own scrolling
        return (
          <PdfViewer 
            filePath={path} 
            onTextSelect={handlePdfTextSelect}
          />
        );
      default:
        return (
          <pre className="whitespace-pre-wrap font-mono text-xs text-foreground/70 leading-relaxed bg-secondary/50 p-6 rounded-xl border border-border/50">
            {content}
          </pre>
        );
    }
  };

  const isPdf = selectedDocument.fileType === 'pdf';
  
  // Use the same detection logic as renderContent
  const normalizedFileType = selectedDocument.fileType?.toLowerCase().trim() || '';
  const pathLower = selectedDocument.path?.toLowerCase() || '';
  const filenameLower = selectedDocument.filename?.toLowerCase() || '';
  const isDocx = 
    normalizedFileType === 'docx' || 
    normalizedFileType === 'doc' ||
    pathLower.endsWith('.docx') || 
    pathLower.endsWith('.doc') ||
    filenameLower.endsWith('.docx') ||
    filenameLower.endsWith('.doc');
  
  // Check if it's a code/text file that uses Monaco Editor
  const codeFileExtensions = ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'yaml', 'yml', 'xml', 'html', 'css', 'scss', 'sass', 'less', 'sql', 'r', 'lua', 'pl', 'log', 'ini', 'conf', 'config'];
  const isCodeFile = 
    normalizedFileType === 'txt' || 
    normalizedFileType === 'json' ||
    codeFileExtensions.some(ext => pathLower.endsWith(`.${ext}`)) ||
    codeFileExtensions.some(ext => filenameLower.endsWith(`.${ext}`));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background border-r border-border/50 relative overflow-hidden">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border/50 bg-background shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-secondary rounded-lg shrink-0">
            {selectedDocument.fileType === 'pdf' ? <FileType className="w-4 h-4 text-muted-foreground" /> : 
             (selectedDocument.fileType === 'docx' || selectedDocument.fileType === 'doc') ? <FileText className="w-4 h-4 text-muted-foreground" /> :
             (selectedDocument.fileType === 'md' || selectedDocument.fileType === 'markdown') ? <FileCode className="w-4 h-4 text-muted-foreground" /> :
             <FileText className="w-4 h-4 text-muted-foreground" />}
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate">
              {selectedDocument.filename}
            </h3>
            <span className="text-xs text-muted-foreground">
              {selectedDocument.fileType.toUpperCase()} file
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (selectedDocument) {
                window.dispatchEvent(new CustomEvent('pin-document', {
                  detail: {
                    path: selectedDocument.path,
                    name: selectedDocument.filename
                  }
                }));
              }
            }}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            title="Pin document (use for all messages)"
          >
            <Paperclip size={16} />
          </button>
          <button 
            onClick={() => setDocViewerOpen(false)}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      {isPdf || isDocx || isCodeFile ? (
        // PDF, DOCX, and code files get special treatment - full height container for their own scroll/editor
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </div>
      ) : (
        <div 
          ref={contentRef}
          onContextMenu={handleContextMenu}
          className="flex-1 overflow-y-auto custom-scrollbar p-6 select-text"
        >
          <div className="max-w-3xl mx-auto">
            {renderContent()}
          </div>
        </div>
      )}

      {contextMenu && (
        <SelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selection={contextMenu.selection}
          onAdd={(text) => {
            handleAddSelection(text, pdfSelectionPage);
            setPdfSelectionPage(undefined);
          }}
          onClose={() => {
            setContextMenu(null);
            setPdfSelectionPage(undefined);
          }}
        />
      )}
    </div>
  );
};
