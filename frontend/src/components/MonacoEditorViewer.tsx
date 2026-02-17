"use client";

import React, { useRef } from "react";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  { 
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Loading editor...</span>
      </div>
    )
  }
);

interface MonacoEditorViewerProps {
  content: string;
  filePath: string;
  language?: string;
  onTextSelect?: (text: string, x: number, y: number) => void;
}

export const MonacoEditorViewer: React.FC<MonacoEditorViewerProps> = ({ 
  content, 
  filePath, 
  language,
  onTextSelect 
}) => {
  const editorRef = useRef<any>(null);

  // Detect language from file extension if not provided
  const detectLanguage = (path: string, providedLanguage?: string): string => {
    if (providedLanguage) return providedLanguage;
    
    const ext = path.toLowerCase().split('.').pop() || '';
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'ps1': 'powershell',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'sql': 'sql',
      'r': 'r',
      'lua': 'lua',
      'pl': 'perl',
      'md': 'markdown',
      'markdown': 'markdown',
      'txt': 'plaintext',
      'log': 'log',
      'ini': 'ini',
      'conf': 'ini',
      'config': 'ini',
    };
    
    return languageMap[ext] || 'plaintext';
  };

  // Helper function to convert RGB/RGBA to hex
  const rgbToHex = (r: number, g: number, b: number): string => {
    const toHex = (n: number) => {
      const hex = Math.round(n).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  // Helper function to blend two colors with opacity
  const blendColors = (color1: string, color2: string, opacity: number): string => {
    const hex1 = color1.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    const hex2 = color2.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    
    if (!hex1 || !hex2) return color1;
    
    const r1 = parseInt(hex1[1], 16);
    const g1 = parseInt(hex1[2], 16);
    const b1 = parseInt(hex1[3], 16);
    const r2 = parseInt(hex2[1], 16);
    const g2 = parseInt(hex2[2], 16);
    const b2 = parseInt(hex2[3], 16);
    
    const blendedR = Math.round(r1 * opacity + r2 * (1 - opacity));
    const blendedG = Math.round(g1 * opacity + g2 * (1 - opacity));
    const blendedB = Math.round(b1 * opacity + b2 * (1 - opacity));
    
    return rgbToHex(blendedR, blendedG, blendedB);
  };

  // Helper function to get CSS variable value and convert to hex
  // Monaco Editor requires hex colors, not rgb/rgba
  const getCSSVariable = (varName: string, opacity?: number): string => {
    if (typeof window === 'undefined') return '#000000';
    
    try {
      const root = document.documentElement;
      const value = getComputedStyle(root).getPropertyValue(varName).trim();
      
      if (!value) return '#000000';
      
      // Create a temporary element to use browser's native color computation
      const tempEl = document.createElement('div');
      tempEl.style.position = 'absolute';
      tempEl.style.visibility = 'hidden';
      tempEl.style.width = '1px';
      tempEl.style.height = '1px';
      
      // Apply the HSL value
      tempEl.style.backgroundColor = `hsl(${value})`;
      
      document.body.appendChild(tempEl);
      const computedColor = getComputedStyle(tempEl).backgroundColor;
      document.body.removeChild(tempEl);
      
      // Convert rgb/rgba to hex
      const rgbMatch = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        
        const baseColor = rgbToHex(r, g, b);
        
        // Monaco doesn't support rgba, so we blend with background for opacity
        if (opacity !== undefined && opacity < 1) {
          // Get background color (without opacity to avoid recursion)
          const bgValue = getComputedStyle(root).getPropertyValue('--background').trim();
          const bgTempEl = document.createElement('div');
          bgTempEl.style.position = 'absolute';
          bgTempEl.style.visibility = 'hidden';
          bgTempEl.style.width = '1px';
          bgTempEl.style.height = '1px';
          bgTempEl.style.backgroundColor = `hsl(${bgValue})`;
          document.body.appendChild(bgTempEl);
          const bgComputed = getComputedStyle(bgTempEl).backgroundColor;
          document.body.removeChild(bgTempEl);
          
          const bgRgbMatch = bgComputed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (bgRgbMatch) {
            const bgR = parseInt(bgRgbMatch[1], 10);
            const bgG = parseInt(bgRgbMatch[2], 10);
            const bgB = parseInt(bgRgbMatch[3], 10);
            const bgColor = rgbToHex(bgR, bgG, bgB);
            return blendColors(baseColor, bgColor, opacity);
          }
        }
        
        return baseColor;
      }
      
      // Fallback: parse HSL manually if browser computation fails
      const hslMatch = value.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
      if (hslMatch) {
        const h = parseFloat(hslMatch[1]);
        const s = parseFloat(hslMatch[2]) / 100;
        const l = parseFloat(hslMatch[3]) / 100;
        
        // Convert HSL to RGB
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        
        let r = 0, g = 0, b = 0;
        
        if (h >= 0 && h < 60) {
          r = c; g = x; b = 0;
        } else if (h >= 60 && h < 120) {
          r = x; g = c; b = 0;
        } else if (h >= 120 && h < 180) {
          r = 0; g = c; b = x;
        } else if (h >= 180 && h < 240) {
          r = 0; g = x; b = c;
        } else if (h >= 240 && h < 300) {
          r = x; g = 0; b = c;
        } else if (h >= 300 && h < 360) {
          r = c; g = 0; b = x;
        }
        
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);
        
        return rgbToHex(r, g, b);
      }
      
      return '#000000'; // Final fallback
    } catch (error) {
      console.warn('Failed to get CSS variable:', varName, error);
      return '#000000';
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Get computed CSS variable values and convert to Monaco-compatible colors
    const background = getCSSVariable('--background');
    const foreground = getCSSVariable('--foreground');
    const mutedForeground = getCSSVariable('--muted-foreground');
    const primary = getCSSVariable('--primary');
    const muted = getCSSVariable('--muted');
    const border = getCSSVariable('--border');

    // Configure Monaco theme to match app
    monaco.editor.defineTheme('atlas-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': background,
        'editor.foreground': foreground,
        'editorLineNumber.foreground': getCSSVariable('--muted-foreground', 0.5),
        'editorLineNumber.activeForeground': foreground,
        'editor.selectionBackground': getCSSVariable('--primary', 0.3),
        'editor.lineHighlightBackground': getCSSVariable('--muted', 0.3),
        'editorCursor.foreground': foreground,
        'editorWhitespace.foreground': getCSSVariable('--muted-foreground', 0.2),
        'editorIndentGuide.background': getCSSVariable('--border', 0.3),
        'editorIndentGuide.activeBackground': getCSSVariable('--border', 0.5),
      }
    });

    monaco.editor.setTheme('atlas-theme');

    // Handle text selection for context menu
    if (onTextSelect) {
      editor.onContextMenu((e: any) => {
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
          const selectedText = editor.getModel()?.getValueInRange(selection) || '';
          if (selectedText.trim()) {
            e.event.preventDefault();
            onTextSelect(selectedText, e.event.browserEvent.clientX, e.event.browserEvent.clientY);
          }
        }
      });
    }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-background">
      <MonacoEditor
        height="100%"
        language={detectLanguage(filePath, language)}
        value={content}
        theme="atlas-theme"
        onChange={() => {}} // Read-only, so onChange is no-op
        onMount={handleEditorDidMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          wordWrap: 'on',
          wrappingIndent: 'indent',
          renderWhitespace: 'selection',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          contextmenu: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
          tabCompletion: 'off',
          wordBasedSuggestions: false,
          parameterHints: { enabled: false },
          hover: { enabled: false },
          links: false,
          colorDecorators: false,
          lightbulb: { enabled: false },
        }}
      />
    </div>
  );
};
