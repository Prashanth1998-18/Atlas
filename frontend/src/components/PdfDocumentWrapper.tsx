"use client";

import React, { useRef, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";

// Configure the worker for pdfjs-dist v3.x
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfDocumentWrapperProps {
  pdfData: Uint8Array;
  numPages: number;
  scale: number;
  onLoadSuccess: (numPages: number) => void;
  onLoadError: (error: string) => void;
}

const PdfDocumentWrapperInner: React.FC<PdfDocumentWrapperProps> = ({
  pdfData,
  numPages,
  scale,
  onLoadSuccess,
  onLoadError,
}) => {
  // Use a ref to store the file object and only recreate when pdfData actually changes
  const fileRef = useRef<{ data: Uint8Array } | null>(null);
  const dataLengthRef = useRef<number>(0);

  // Only create a new file object if the data length changed (simple but effective check)
  if (!fileRef.current || dataLengthRef.current !== pdfData.length) {
    // Create a copy of the data to prevent detachment issues
    const dataCopy = new Uint8Array(pdfData);
    fileRef.current = { data: dataCopy };
    dataLengthRef.current = pdfData.length;
  }

  return (
    <Document
      file={fileRef.current}
      onLoadSuccess={({ numPages }) => onLoadSuccess(numPages)}
      onLoadError={(error) => onLoadError(error.message)}
      loading={
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Rendering PDF...</span>
        </div>
      }
      className="pdf-document"
    >
      {/* Render all pages for continuous scroll */}
      {numPages > 0 ? (
        Array.from({ length: numPages }, (_, index) => (
          <div key={`page-${index + 1}`} className="mb-4 last:mb-0" data-page-number={index + 1}>
            <Page
              pageNumber={index + 1}
              scale={scale}
              className="pdf-page shadow-lg"
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </div>
        ))
      ) : (
        <Page
          pageNumber={1}
          scale={scale}
          className="pdf-page shadow-lg"
          renderTextLayer={true}
          renderAnnotationLayer={true}
        />
      )}
    </Document>
  );
};

// Memoize the component to prevent unnecessary re-renders
const PdfDocumentWrapper = memo(PdfDocumentWrapperInner, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render)
  // Return false if props are different (re-render)
  
  // Allow re-render for scale and numPages changes
  if (prevProps.scale !== nextProps.scale) return false;
  if (prevProps.numPages !== nextProps.numPages) return false;
  
  // For pdfData, compare by length (quick check) - same length = same file
  if (prevProps.pdfData.length !== nextProps.pdfData.length) return false;
  
  // If same length, assume same file (avoid expensive byte comparison)
  return true;
});

export default PdfDocumentWrapper;
