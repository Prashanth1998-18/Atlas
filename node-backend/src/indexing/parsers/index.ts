import { parsePdf } from './pdf.js';
import { parseDocx } from './docx.js';
import { parseMarkdown, parseMarkdownSimple } from './markdown.js';
import { parseText, parseTextSimple } from './text.js';
import { parsePdfForIndexing } from '../extraction/pdfVisionIndexing.js';

export type ParseResult = {
  text: string;
  metadata?: Record<string, any>;
};

export type ParseOptions = {
  onProgress?: (message: string) => void;
  existingMetadata?: Record<string, unknown>;
};

/**
 * Registry of document parsers by file extension.
 */
export class ParserRegistry {
  private static parsers: Record<string, (path: string, options?: ParseOptions) => Promise<ParseResult>> = {
    // PDF
    '.pdf': async (path, options) => await parsePdfForIndexing(path, options),
    
    // Word Documents
    '.docx': async (path) => ({ text: await parseDocx(path) }),
    
    // Markdown
    '.md': async (path) => {
      const result = await parseMarkdown(path);
      return { text: result.text, metadata: result.metadata };
    },
    '.markdown': async (path) => {
      const result = await parseMarkdown(path);
      return { text: result.text, metadata: result.metadata };
    },
    
    // Plain Text
    '.txt': async (path) => {
      const result = await parseText(path);
      return { text: result.text, metadata: result.metadata };
    },
    
    // Code files (treat as plain text)
    '.js': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'javascript' } }),
    '.ts': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'typescript' } }),
    '.jsx': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'react-jsx' } }),
    '.tsx': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'react-tsx' } }),
    '.py': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'python' } }),
    '.rs': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'rust' } }),
    '.go': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'go' } }),
    '.java': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'java' } }),
    '.json': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'json' } }),
    '.html': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'html' } }),
    '.css': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'css' } }),
    '.yaml': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'yaml' } }),
    '.yml': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'yaml' } }),
    '.toml': async (path) => ({ text: await parseTextSimple(path), metadata: { type: 'toml' } }),
  };

  /**
   * Check if a file extension is supported.
   */
  static isSupported(ext: string): boolean {
    return ext.toLowerCase() in this.parsers;
  }

  /**
   * Get the list of supported extensions.
   */
  static getSupportedExtensions(): string[] {
    return Object.keys(this.parsers);
  }

  /**
   * Parse a file by its extension.
   */
  static async parse(path: string, options?: ParseOptions): Promise<ParseResult | null> {
    const ext = '.' + path.split('.').pop()?.toLowerCase();
    const parser = this.parsers[ext];
    
    if (!parser) {
      return null;
    }
    
    try {
      return await parser(path, options);
    } catch (error: any) {
      console.error(`Failed to parse ${path}: ${error.message}`);
      return null;
    }
  }

  /**
   * Register a custom parser for an extension.
   */
  static register(ext: string, parser: (path: string, options?: ParseOptions) => Promise<ParseResult>): void {
    this.parsers[ext.toLowerCase()] = parser;
  }
}

// Re-export individual parsers for direct use
export { parsePdf } from './pdf.js';
export { parseDocx } from './docx.js';
export { parseMarkdown, parseMarkdownSimple } from './markdown.js';
export { parseText, parseTextSimple } from './text.js';
