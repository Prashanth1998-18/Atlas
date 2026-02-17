import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, extname, isAbsolute, normalize, dirname, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type { SQLiteStorage } from '../../storage/sqlite.js';

// In-memory todo storage (per workspace session)
let currentTodos: Array<{ id: string; content: string; status: string }> = [];

// Binary file extensions that need special parsing
const BINARY_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.py', '.rs', '.go', '.java', '.yaml', '.yml', '.xml', '.toml', '.sh', '.bat', '.ps1']);

/**
 * Resolve a path that may be relative or absolute.
 * If absolute and within workspace, use as-is.
 * If absolute but outside workspace, use as-is.
 * If relative, join with workspace path.
 * Handles cases where path accidentally includes workspace path prefix.
 */
function resolvePath(workspacePath: string, inputPath: string): string {
  const normalizedInput = normalize(inputPath);
  const normalizedWorkspace = normalize(workspacePath);
  
  // If the path already starts with the workspace path, use it directly
  if (normalizedInput.startsWith(normalizedWorkspace)) {
    return normalizedInput;
  }
  
  // If it's an absolute path (but doesn't start with workspace), use it as-is
  if (isAbsolute(normalizedInput)) {
    return normalizedInput;
  }
  
  // Otherwise, it's relative - join with workspace
  return join(normalizedWorkspace, normalizedInput);
}

/**
 * Normalize pinned document paths to relative paths (as stored in LanceDB).
 * LanceDB stores doc_path as relative paths, so we need to normalize pinned docs
 * which may be absolute paths.
 */
function normalizePinnedPaths(workspacePath: string, pinnedDocs: string[]): string[] {
  return pinnedDocs.map(p => {
    const resolved = resolvePath(workspacePath, p);
    return relative(workspacePath, resolved);
  });
}

/**
 * Build a LanceDB filter string for pinned documents.
 * Returns a SQL-like WHERE clause that can be used with the filter parameter.
 * Handles single document (equality) or multiple documents (IN clause).
 */
function buildPinnedDocsFilter(workspacePath: string, pinnedDocs: string[]): string | undefined {
  if (pinnedDocs.length === 0) {
    return undefined;
  }
  
  const normalizedPaths = normalizePinnedPaths(workspacePath, pinnedDocs);
  
  // Escape single quotes in paths (SQL injection protection)
  const escapedPaths = normalizedPaths.map(p => `'${p.replace(/'/g, "''")}'`);
  
  if (normalizedPaths.length === 1) {
    return `doc_path = ${escapedPaths[0]}`;
  } else {
    return `doc_path IN (${escapedPaths.join(', ')})`;
  }
}

/**
 * Build a LanceDB filter string to exclude pinned documents.
 * Returns a SQL-like WHERE clause using NOT IN syntax.
 */
function buildExcludePinnedDocsFilter(workspacePath: string, pinnedDocs: string[]): string | undefined {
  if (pinnedDocs.length === 0) {
    return undefined;
  }
  
  const normalizedPaths = normalizePinnedPaths(workspacePath, pinnedDocs);
  
  // Escape single quotes in paths (SQL injection protection)
  const escapedPaths = normalizedPaths.map(p => `'${p.replace(/'/g, "''")}'`);
  
  if (normalizedPaths.length === 1) {
    return `doc_path != ${escapedPaths[0]}`;
  } else {
    return `doc_path NOT IN (${escapedPaths.join(', ')})`;
  }
}

/**
 * Read a file with smart type detection.
 * Uses appropriate parsers for binary formats (PDF, DOCX).
 */
async function smartReadFile(fullPath: string): Promise<string> {
  const ext = extname(fullPath).toLowerCase();

  // Handle PDF files
  if (ext === '.pdf') {
    try {
      const { parsePdf } = await import('../../indexing/parsers/pdf.js');
      const content = await parsePdf(fullPath);
      console.error(`[Parser] Successfully parsed PDF: ${fullPath}`);
      return content;
    } catch (error: any) {
      console.error(`[Parser] Error parsing PDF ${fullPath}:`, error.message);
      return `[Error parsing PDF: ${error.message}]`;
    }
  }

  // Handle Word documents (.docx)
  if (ext === '.docx') {
    try {
      const { parseDocx } = await import('../../indexing/parsers/docx.js');
      const content = await parseDocx(fullPath);
      console.error(`[Parser] Successfully parsed DOCX: ${fullPath}`);
      return content;
    } catch (error: any) {
      console.error(`[Parser] Error parsing DOCX ${fullPath}:`, error.message);
      return `[Error parsing Word document: ${error.message}]`;
    }
  }

  // Handle legacy Word documents (.doc) - not supported, provide helpful message
  if (ext === '.doc') {
    return `[Error: Legacy .doc format is not supported. Please convert to .docx format using Microsoft Word or LibreOffice.]`;
  }

  // Fallback: Read file as buffer to check for magic bytes or binary content
  const buffer = await fs.readFile(fullPath);

  // Check for PDF magic bytes (%PDF) - handles files without .pdf extension
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    try {
      const { parsePdf } = await import('../../indexing/parsers/pdf.js');
      const content = await parsePdf(fullPath);
      console.error(`[Parser] Successfully parsed PDF (detected by magic bytes): ${fullPath}`);
      return content;
    } catch (error: any) {
      console.error(`[Parser] Error parsing PDF ${fullPath}:`, error.message);
      return `[Error parsing PDF: ${error.message}]`;
    }
  }

  // Check for DOCX magic bytes (PK - ZIP archive, which DOCX files are)
  if (buffer.subarray(0, 2).toString('ascii') === 'PK') {
    try {
      const { parseDocx } = await import('../../indexing/parsers/docx.js');
      const content = await parseDocx(fullPath);
      console.error(`[Parser] Successfully parsed DOCX (detected by magic bytes): ${fullPath}`);
      return content;
    } catch (error: any) {
      // It might be a ZIP file but not a DOCX, or corrupted
      console.error(`[Parser] Error parsing as DOCX ${fullPath}:`, error.message);
      return `[Error: File appears to be a ZIP archive but could not be parsed as a Word document: ${error.message}]`;
    }
  }

  // Simple binary check: look for null bytes in the first 1024 bytes (heuristic)
  // This prevents returning garbage for unknown binary files
  const isBinary = buffer.subarray(0, Math.min(buffer.length, 1024)).includes(0);
  if (isBinary) {
    return `[Error: File appears to be binary and not a supported document type (${ext || 'unknown'}). Supported formats: .txt, .md, .pdf, .docx, and common code files.]`;
  }

  // If text, return string
  return buffer.toString('utf8');
}

interface CreateToolsOptions {
  sqlite?: SQLiteStorage;
  conversationId?: string;
}

function hasExplicitDocumentIntent(message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (!text) return false;

  const createVerb = /\b(create|write|draft|generate|prepare|compose|produce|make)\b/;
  const docNoun = /\b(document|doc|report|summary|memo|note|letter|email|proposal|brief|plan)\b/;

  if (createVerb.test(text) && docNoun.test(text)) return true;
  if (/\b(save|export|download)\b/.test(text) && /\b(document|doc|file|markdown|md|docx|txt)\b/.test(text)) return true;
  if (/\b(save that|save this|save it|turn this into)\b/.test(text)) return true;
  if (/\b(as a document|as markdown|as md|as docx|as txt)\b/.test(text)) return true;
  if (/\b(bring back|restore|recover)\b/.test(text) && /\b(draft|document|doc)\b/.test(text)) return true;

  return false;
}

export function createTools(
  workspacePath: string,
  lancedb?: any,
  pinnedDocs: string[] = [],
  options: CreateToolsOptions = {}
): DynamicStructuredTool[] {
  // Reset todos when workspace changes
  currentTodos = [];
  const sqlite = options.sqlite;
  const conversationId = options.conversationId;

  return [
    // ==================== FILESYSTEM TOOLS ====================
    
    new DynamicStructuredTool({
      name: 'list_directory',
      description: 'List files and directories at a given path within the workspace.',
      schema: z.object({
        path: z.string().describe('The path to list, relative to the workspace root. Use "." for root.'),
      }),
      func: async ({ path }) => {
        try {
          const fullPath = resolvePath(workspacePath, path);
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          return JSON.stringify(entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
          })));
        } catch (error: any) {
          return `Error listing directory: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'read_file',
      description: 'Read the full content of a file. Supports text files, PDFs, and Word documents. CRITICAL: ONLY use this when the user asks for the ENTIRE file or doesn\'t specify line numbers. If the user asks for specific lines (e.g., "lines 1-15", "read lines 10-20"), you MUST use read_file_chunk instead. If the file is not found, the tool will suggest similar filenames to help identify typos. NOTE: Pinned/mentioned documents are your PRIMARY context - prioritize reading from them first.',
      schema: z.object({
        path: z.string().describe('The path to the file, relative to the workspace root.'),
      }),
      func: async ({ path }) => {
        try {
          const fullPath = resolvePath(workspacePath, path);
          const content = await smartReadFile(fullPath);
          return content;
        } catch (error: any) {
          // Check if it's a "file not found" error
          if (error.code === 'ENOENT' || error.message.includes('not found') || error.message.includes('ENOENT')) {
            const suggestions = await findSimilarFiles(workspacePath, path);
            let errorMsg = `File not found: ${path}`;
            
            if (suggestions.length > 0) {
              errorMsg += `\n\nDid you mean one of these files?\n${suggestions.map((s: string) => `  - ${s}`).join('\n')}`;
              errorMsg += `\n\nCommon issues:\n`;
              errorMsg += `  - Check for typos in the filename or extension (e.g., .pd instead of .pdf)\n`;
              errorMsg += `  - Verify the file path is correct\n`;
              errorMsg += `  - Use list_directory to browse available files`;
            } else {
              errorMsg += `\n\nPlease verify:\n`;
              errorMsg += `  - The filename and extension are correct (common typos: .pd instead of .pdf, .doc instead of .docx)\n`;
              errorMsg += `  - The file path is correct\n`;
              errorMsg += `  - Use list_directory or hybrid_search to find the correct file`;
            }
            
            return errorMsg;
          }
          
          return `Error reading file: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'read_file_chunk',
      description: 'MANDATORY when user requests specific lines (e.g., "read lines 1-15", "lines 10-20"). Read a specific range of lines from a file. Supports text files, PDFs, and Word documents. CRITICAL: If the user asks for specific line numbers, you MUST use this tool instead of read_file. Always use EXACT file paths from search results.',
      schema: z.object({
        path: z.string().describe('The path to the file, relative to the workspace root.'),
        start_line: z.number().describe('The starting line number (1-indexed).'),
        end_line: z.number().describe('The ending line number (inclusive).'),
      }),
      func: async ({ path, start_line, end_line }) => {
        try {
          const fullPath = resolvePath(workspacePath, path);
          // Use smartReadFile to properly parse PDFs, DOCX, etc.
          const content = await smartReadFile(fullPath);
          const lines = content.split('\n');
          const totalLines = lines.length;
          
          const startIdx = Math.max(0, start_line - 1);
          const endIdx = Math.min(totalLines, end_line);
          
          const chunk = lines.slice(startIdx, endIdx);
          return JSON.stringify({
            content: chunk.join('\n'),
            start_line: startIdx + 1,
            end_line: endIdx,
            total_lines: totalLines,
          });
        } catch (error: any) {
          return `Error reading file chunk: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'get_file_info',
      description: 'Get metadata about a file (size, modification time, type).',
      schema: z.object({
        path: z.string().describe('The path to the file, relative to the workspace root.'),
      }),
      func: async ({ path }) => {
        try {
          const fullPath = resolvePath(workspacePath, path);
          const stats = await stat(fullPath);
          const ext = path.split('.').pop()?.toLowerCase() || '';
          
          return JSON.stringify({
            path: path,
            size_bytes: stats.size,
            size_human: formatBytes(stats.size),
            modified: new Date(stats.mtimeMs).toISOString(),
            created: new Date(stats.birthtimeMs).toISOString(),
            is_directory: stats.isDirectory(),
            extension: ext,
            file_type: getFileType(ext),
          });
        } catch (error: any) {
          return `Error getting file info: ${error.message}`;
        }
      },
    }),

    // ==================== SEARCH TOOLS ====================

    new DynamicStructuredTool({
      name: 'grep_search',
      description: 'Search for an exact string pattern across all files in the workspace. Pinned/mentioned documents are searched FIRST. Returns file paths and matching lines WITH LINE NUMBERS in the "matches" array. CRITICAL: When you see matches with line numbers, use read_file_chunk to read only those relevant sections (with context padding like ±10 lines), NOT read_file to read entire files. This is much more efficient. RESPONSE FORMAT: Returns JSON with a "file_paths" array and a "matches" array containing {file, line, content}. Use the EXACT paths and line numbers from matches when calling read_file_chunk. Do NOT modify or construct paths.',
      schema: z.object({
        pattern: z.string().describe('The string pattern to search for.'),
        include_context: z.boolean().optional().describe('Whether to include surrounding lines (default: false).'),
      }),
      func: async ({ pattern, include_context = false }) => {
        try {
          const pinnedResults: Array<{ file: string; line: number; content: string; context?: string[] }> = [];
          const otherResults: Array<{ file: string; line: number; content: string; context?: string[] }> = [];
          const pinnedPathsSet = new Set(pinnedDocs.map(p => resolvePath(workspacePath, p)));
          
          // PRIORITY: Search pinned docs first
          for (const pinnedPath of pinnedDocs) {
            try {
              const fullPath = resolvePath(workspacePath, pinnedPath);
              const content = await fs.readFile(fullPath, 'utf8');
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                if (line.includes(pattern)) {
                  const result: any = {
                    file: relative(workspacePath, fullPath),
                    line: idx + 1,
                    content: line.trim(),
                  };
                  if (include_context) {
                    result.context = lines.slice(Math.max(0, idx - 2), idx + 3);
                  }
                  pinnedResults.push(result);
                }
              });
            } catch {
              // Skip if file doesn't exist or is binary
            }
          }
          
          // Then search the rest of the workspace
          const walk = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const res = join(dir, entry.name);
              if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                  await walk(res);
                }
              } else {
                // Skip if this file is pinned (already searched)
                const fullPath = resolvePath(workspacePath, res);
                if (pinnedPathsSet.has(fullPath)) {
                  continue;
                }
                
                try {
                  const content = await fs.readFile(res, 'utf8');
                  const lines = content.split('\n');
                  lines.forEach((line, idx) => {
                    if (line.includes(pattern)) {
                      const result: any = {
                        file: relative(workspacePath, res),
                        line: idx + 1,
                        content: line.trim(),
                      };
                      if (include_context) {
                        result.context = lines.slice(Math.max(0, idx - 2), idx + 3);
                      }
                      otherResults.push(result);
                    }
                  });
                } catch {
                  // Skip binary/unreadable files
                }
              }
            }
          };
          
          await walk(workspacePath);
          
          // Combine: Pinned first, then others
          const results = [...pinnedResults, ...otherResults];
          
          if (results.length === 0) return 'No matches found.';
          
          // Extract unique file paths (pinned docs will appear first)
          const pinnedFiles = new Set(pinnedResults.map(r => r.file).filter(Boolean));
          const otherFiles = new Set(otherResults.map(r => r.file).filter(Boolean));
          const uniqueFiles = [...Array.from(pinnedFiles), ...Array.from(otherFiles)];
          
          // Format response to make file paths clear
          const response = {
            // PRIMARY: Use this array for all file paths - pinned docs appear first
            file_paths: uniqueFiles,
            
            // Detailed matches (for reference) - pinned docs first
            matches: results.slice(0, 50),
            
            // Summary
            pinned_docs_found: pinnedFiles.size,
            total_files_found: uniqueFiles.length,
            total_matches: results.length,
            note: "Use the 'file_paths' array above. Pinned documents appear first. The 'matches' array contains line numbers - use read_file_chunk with those line numbers (with context padding) instead of read_file to read entire files. Copy paths exactly as shown."
          };
          
          return JSON.stringify(response, null, 2);
        } catch (error: any) {
          return `Error during grep search: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'hybrid_search',
      description: 'Primary search tool. Combines keyword matching and semantic (meaning-based) search for comprehensive results. CRITICAL: Pinned/mentioned documents are searched FIRST and appear at the top of results - these are your PRIMARY context. IMPORTANT: Use elaborate, multi-keyword queries with synonyms. Example: Instead of just "Prashanth", search "Prashanth payment invoice payslip earnings salary". RESPONSE FORMAT: Returns JSON with "semantic_matches" array containing FULL TEXT of matching chunks (not snippets). DECISION WORKFLOW: 1) First, evaluate if the text chunks are sufficient to answer the question. 2) If yes, use the "text" field directly - DO NOT call read_file or read_file_chunk. 3) If no (chunks incomplete, need surrounding context, or user asks for specific lines), then use read_file_chunk. The vector database already contains the full chunk text - be smart about when you actually need more. The "file_paths" array is provided for reference only.',
      schema: z.object({
        query: z.string().describe('A comprehensive search query with multiple related keywords and synonyms. Example: "Prashanth invoice payment payslip earnings" not just "Prashanth".'),
        top_k: z.number().optional().describe('Number of results per method (default: 5). CRITICAL: For aggregate questions or when searching for multiple documents, increase this to 10-20 to ensure you find all relevant files. If user mentions a specific number (e.g., "4 paystubs"), set top_k to at least that number or higher.'),
      }),
      func: async ({ query, top_k = 5 }) => {
        const grepResults: string[] = [];
        const grepMatches: Array<{ file: string; line: number; content: string }> = [];
        const semanticResults: any[] = [];
        const pinnedGrepResults: string[] = [];
        const pinnedGrepMatches: Array<{ file: string; line: number; content: string }> = [];
        const pinnedSemanticResults: any[] = [];
        
        // Extract keywords from query for better matching
        const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
        
        // PRIORITY: Search within pinned docs first
        if (pinnedDocs.length > 0) {
          // Grep search in pinned docs (line-by-line for line numbers)
          for (const pinnedPath of pinnedDocs) {
            try {
              const fullPath = resolvePath(workspacePath, pinnedPath);
              const content = await fs.readFile(fullPath, 'utf8');
              const lines = content.split('\n');
              let fileMatched = false;
              
              lines.forEach((line, idx) => {
                const lineLower = line.toLowerCase();
                // Match if line contains query or any keyword
                if (lineLower.includes(query.toLowerCase()) || keywords.some((kw: string) => lineLower.includes(kw))) {
                  if (!fileMatched) {
                    pinnedGrepResults.push(relative(workspacePath, fullPath));
                    fileMatched = true;
                  }
                  pinnedGrepMatches.push({
                    file: relative(workspacePath, fullPath),
                    line: idx + 1,
                    content: line.trim(),
                  });
                }
              });
            } catch {
              // Skip if file doesn't exist or is binary
            }
          }
          
          // Semantic search in pinned docs - use filter to scope search from the start
          if (lancedb) {
            try {
              const { Embedder } = await import('../../indexing/embedder.js');
              const embedder = new Embedder();
              const vector = await embedder.embedText(query);
              const filter = buildPinnedDocsFilter(workspacePath, pinnedDocs);
              // Search is now scoped to pinned docs via filter, so we get top_k directly
              const results = await lancedb.search(vector, top_k, filter);
              pinnedSemanticResults.push(...results);
            } catch {
              // Continue without semantic results
            }
          }
        }
        
        // Then search the rest of the workspace (if needed)
        try {
          const walk = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const res = join(dir, entry.name);
              if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                  await walk(res);
                }
              } else {
                // Skip if this file is pinned (already searched)
                const relPath = relative(workspacePath, res);
                if (pinnedDocs.some(p => relPath === p || res === resolvePath(workspacePath, p))) {
                  continue;
                }
                
                try {
                  const content = await fs.readFile(res, 'utf8');
                  const lines = content.split('\n');
                  let fileMatched = false;
                  
                  lines.forEach((line, idx) => {
                    const lineLower = line.toLowerCase();
                    // Match if line contains query or any keyword
                    if (lineLower.includes(query.toLowerCase()) || keywords.some((kw: string) => lineLower.includes(kw))) {
                      if (!fileMatched) {
                        grepResults.push(relPath);
                        fileMatched = true;
                      }
                      grepMatches.push({
                        file: relPath,
                        line: idx + 1,
                        content: line.trim(),
                      });
                    }
                  });
                } catch {
                  // Skip binary files
                }
              }
            }
          };
          await walk(workspacePath);
        } catch {
          // Continue with semantic search
        }
        
        // Semantic search in non-pinned docs - use filter to exclude pinned docs from the start
        if (lancedb) {
          try {
            const { Embedder } = await import('../../indexing/embedder.js');
            const embedder = new Embedder();
            const vector = await embedder.embedText(query);
            const filter = buildExcludePinnedDocsFilter(workspacePath, pinnedDocs);
            // Search is now scoped to exclude pinned docs via filter
            const results = await lancedb.search(vector, top_k, filter);
            semanticResults.push(...results);
          } catch {
            // Continue without semantic results
          }
        }
        
        // Combine: Pinned docs FIRST, then others
        const allFiles = new Set([
          ...pinnedGrepResults,
          ...pinnedSemanticResults.map((r: any) => r.doc_path),
          ...grepResults.slice(0, top_k),
          ...semanticResults.map((r: any) => r.doc_path),
        ]);
        
        const uniqueFilesArray = Array.from(allFiles).filter(Boolean);
        
        // Format response to make file paths very clear
        const response = {
          // PRIMARY: Use this array for all file paths - pinned docs appear FIRST
          file_paths: uniqueFilesArray,
          
          // Detailed breakdown (for reference)
          pinned_docs_found: pinnedGrepResults.length + pinnedSemanticResults.length,
          exact_matches: [...pinnedGrepResults, ...grepResults.slice(0, top_k)],
          // Keyword matches with line numbers (from grep search)
          keyword_matches: [...pinnedGrepMatches, ...grepMatches].slice(0, 50),
          semantic_matches: [
            ...pinnedSemanticResults.slice(0, top_k).map((r: any) => ({
              document: r.doc_path,
              text: r.text || '', // Full chunk text - use this directly, don't read file again
              chunk_index: r.chunk_index,
              is_pinned: true,
            })),
            ...semanticResults.slice(0, top_k).map((r: any) => ({
              document: r.doc_path,
              text: r.text || '', // Full chunk text - use this directly, don't read file again
              chunk_index: r.chunk_index,
              is_pinned: false,
            })),
          ],
          
          // Summary
          total_files_found: uniqueFilesArray.length,
          note: "CRITICAL: The 'semantic_matches' array contains FULL TEXT of matching chunks. The 'keyword_matches' array contains line numbers from keyword search. DECISION WORKFLOW: 1) First, evaluate if the semantic chunks are sufficient to answer the question. 2) If yes, use the 'text' field directly - DO NOT call read_file or read_file_chunk. 3) If no (chunks incomplete, need surrounding context): Use line numbers from 'keyword_matches' array to call read_file_chunk with dynamic padding. If keyword_matches is empty but you need line numbers, use grep_search. Be smart - only read files when you genuinely need more context beyond search results."
        };
        
        return JSON.stringify(response, null, 2);
      },
    }),

    // ==================== DOCUMENT CREATION ====================

    new DynamicStructuredTool({
      name: 'create_document',
      description: 'Create, update, or restore a markdown document draft for user review. Use this ONLY when the user explicitly asks to create/write/save/export/recover a document. If refining an existing active draft, set replace_active=true. If recovering a discarded/saved draft, set recover_latest=true.',
      schema: z.object({
        filename: z.string().optional().describe('Suggested filename without extension, e.g. "research-summary". Optional when restoring latest draft.'),
        content: z.string().optional().describe('Markdown content for the document draft. Required for create/update; optional when recover_latest=true.'),
        location: z.string().optional().describe('Suggested workspace-relative folder path. Use "" or "." for workspace root.'),
        replace_active: z.boolean().optional().describe('Set true only when updating/refining the currently active draft.'),
        recover_latest: z.boolean().optional().describe('Set true when user asks to bring back a previously discarded/saved draft.'),
      }),
      func: async ({ filename = '', content = '', location = '', replace_active = false, recover_latest = false }) => {
        try {
          const safeFilename = String(filename || '').trim();
          const safeContent = String(content || '').trim();
          const safeLocation = String(location || '').trim();

          if (!sqlite || !conversationId) {
            return JSON.stringify({
              status: 'error',
              message: 'Document drafting is unavailable in this context.',
            });
          }

          const lastUserMessage = (() => {
            const history = sqlite.listMessages(conversationId);
            for (let i = history.length - 1; i >= 0; i -= 1) {
              const row = history[i] as { role?: string; content?: string };
              if (row.role === 'user') {
                return String(row.content || '');
              }
            }
            return '';
          })();

          const explicitIntent = hasExplicitDocumentIntent(lastUserMessage);
          const activeDraft = sqlite.getActiveDocumentDraft(conversationId);

          if (!activeDraft && !explicitIntent) {
            return JSON.stringify({
              status: 'blocked',
              message: 'Document draft creation requires an explicit request. Continue normal chat for non-document messages.',
            });
          }

          const shouldRecoverLatest = Boolean(recover_latest) && !activeDraft;

          if (shouldRecoverLatest) {
            const latest = sqlite.getLatestDocumentDraft(conversationId);
            if (!latest) {
              return JSON.stringify({
                status: 'error',
                message: 'No previous draft found to restore.',
              });
            }

            const restored = sqlite.setDocumentDraftStatus(latest.id, 'active', {
              restored_by_tool: true,
              restored_at: Date.now(),
            });

            if (!restored) {
              return JSON.stringify({
                status: 'error',
                message: 'Failed to restore the latest draft.',
              });
            }

            const restoredWithOverrides = sqlite.updateDocumentDraft(restored.id, {
              filename: safeFilename || restored.filename,
              content: safeContent || restored.content,
              location: safeLocation || restored.location,
              metadata: {
                restored_by_tool: true,
                restored_at: Date.now(),
              },
            });

            const finalRestored = restoredWithOverrides ?? restored;
            return JSON.stringify({
              status: 'restored',
              message: 'Restored the latest draft.',
              draft: {
                id: finalRestored.id,
                conversation_id: finalRestored.conversation_id,
                filename: finalRestored.filename,
                content: finalRestored.content,
                location: finalRestored.location,
                status: finalRestored.status,
                created_at: finalRestored.created_at,
                updated_at: finalRestored.updated_at,
              },
            });
          }

          if (!safeContent) {
            return JSON.stringify({
              status: 'error',
              message: 'Draft content cannot be empty.',
            });
          }

          const shouldUpdateActive =
            Boolean(activeDraft) &&
            (replace_active ||
              (safeFilename.length > 0 &&
                String(activeDraft?.filename || '').toLowerCase() === safeFilename.toLowerCase()));

          if (activeDraft && !shouldUpdateActive) {
            return JSON.stringify({
              status: 'blocked',
              message: 'An active draft already exists. Ask the user to approve or discard it before creating a new draft.',
              active_draft: {
                id: activeDraft.id,
                filename: activeDraft.filename,
                location: activeDraft.location,
              },
            });
          }

          if (activeDraft && shouldUpdateActive) {
            const updated = sqlite.updateDocumentDraft(activeDraft.id, {
              filename: safeFilename || activeDraft.filename,
              content: safeContent,
              location: safeLocation || activeDraft.location,
              metadata: {
                updated_by_tool: true,
                updated_at: Date.now(),
              },
            });

            if (!updated) {
              return JSON.stringify({
                status: 'error',
                message: 'Failed to update the active draft.',
              });
            }

            return JSON.stringify({
              status: 'updated',
              message: 'Updated the active draft.',
              draft: {
                id: updated.id,
                conversation_id: updated.conversation_id,
                filename: updated.filename,
                content: updated.content,
                location: updated.location,
                status: updated.status,
                created_at: updated.created_at,
                updated_at: updated.updated_at,
              },
            });
          }

          const created = sqlite.createDocumentDraft(
            conversationId,
            safeFilename || 'untitled-document',
            safeContent,
            safeLocation,
            {
              created_by_tool: true,
              created_at: Date.now(),
            }
          );

          return JSON.stringify({
            status: 'created',
            message: 'Created a new document draft.',
            draft: {
              id: created.id,
              conversation_id: created.conversation_id,
              filename: created.filename,
              content: created.content,
              location: created.location,
              status: created.status,
              created_at: created.created_at,
              updated_at: created.updated_at,
            },
          });
        } catch (error: any) {
          return JSON.stringify({
            status: 'error',
            message: `Failed to create draft: ${error.message}`,
          });
        }
      },
    }),

    // ==================== PLANNING TOOLS ====================

    new DynamicStructuredTool({
      name: 'todo_write',
      description: 'Create or update a task list for multi-step work. Use this to plan complex tasks.',
      schema: z.object({
        todos: z.array(z.object({
          id: z.string().describe('Unique identifier for the task.'),
          content: z.string().describe('Description of the task.'),
          status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status.'),
        })).describe('Array of todo items.'),
        merge: z.boolean().optional().describe('If true, merge with existing todos. If false, replace all (default: true).'),
      }),
      func: async ({ todos, merge = true }) => {
        if (merge) {
          for (const todo of todos) {
            const existingIdx = currentTodos.findIndex(t => t.id === todo.id);
            if (existingIdx >= 0) {
              currentTodos[existingIdx] = todo;
            } else {
              currentTodos.push(todo);
            }
          }
        } else {
          currentTodos = todos;
        }
        
        return JSON.stringify({
          message: 'Todo list updated.',
          todos: currentTodos,
        });
      },
    }),

    new DynamicStructuredTool({
      name: 'todo_read',
      description: 'Read the current task list to check progress on multi-step work.',
      schema: z.object({}),
      func: async () => {
        if (currentTodos.length === 0) {
          return JSON.stringify({ message: 'No todos currently set.', todos: [] });
        }
        
        const summary = {
          total: currentTodos.length,
          pending: currentTodos.filter(t => t.status === 'pending').length,
          in_progress: currentTodos.filter(t => t.status === 'in_progress').length,
          completed: currentTodos.filter(t => t.status === 'completed').length,
          cancelled: currentTodos.filter(t => t.status === 'cancelled').length,
        };
        
        return JSON.stringify({
          summary,
          todos: currentTodos,
        });
      },
    }),

    // ==================== UTILITY TOOLS ====================

    new DynamicStructuredTool({
      name: 'calculator',
      description: 'Perform mathematical calculations. Supports basic arithmetic (+, -, *, /), exponents (**), parentheses, and common math functions (sqrt, abs, sin, cos, tan, log, exp, round, floor, ceil, min, max). Use this for any numerical calculations.',
      schema: z.object({
        expression: z.string().describe('The mathematical expression to evaluate. Examples: "2 + 2", "sqrt(16)", "10 * 5 / 2", "(100 - 20) * 0.15", "max(10, 20, 30)"'),
      }),
      func: async ({ expression }) => {
        try {
          // Create a safe math context with common functions
          const mathContext: Record<string, any> = {
            sqrt: Math.sqrt,
            abs: Math.abs,
            sin: Math.sin,
            cos: Math.cos,
            tan: Math.tan,
            log: Math.log,
            log10: Math.log10,
            exp: Math.exp,
            pow: Math.pow,
            round: Math.round,
            floor: Math.floor,
            ceil: Math.ceil,
            min: Math.min,
            max: Math.max,
            PI: Math.PI,
            E: Math.E,
          };

          // Sanitize expression - only allow safe characters and function names
          const sanitized = expression
            .replace(/\s+/g, '') // Remove whitespace
            .replace(/,/g, ','); // Keep commas for function arguments

          // Check for disallowed patterns (security)
          const disallowed = /[a-zA-Z_$][a-zA-Z0-9_$]*(?!\s*\()/g;
          const matches = sanitized.match(disallowed);
          if (matches) {
            // Filter out allowed math function names and constants
            const allowed = new Set(Object.keys(mathContext));
            const invalid = matches.filter((m: string) => !allowed.has(m));
            if (invalid.length > 0) {
              return JSON.stringify({
                error: `Invalid identifier(s) in expression: ${invalid.join(', ')}`,
                hint: 'Only numbers, operators (+, -, *, /, **, %), parentheses, and math functions (sqrt, abs, sin, cos, tan, log, exp, round, floor, ceil, min, max, PI, E) are allowed.',
              });
            }
          }

          // Build the function with math context
          const funcBody = `
            const { ${Object.keys(mathContext).join(', ')} } = this;
            return (${expression});
          `;
          
          const calculate = new Function(funcBody);
          const result = calculate.call(mathContext);

          if (typeof result !== 'number' || !isFinite(result)) {
            return JSON.stringify({
              error: 'Calculation resulted in an invalid number',
              result: String(result),
            });
          }

          return JSON.stringify({
            expression: expression,
            result: result,
            formatted: Number.isInteger(result) ? result.toString() : result.toFixed(10).replace(/\.?0+$/, ''),
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `Failed to evaluate expression: ${error.message}`,
            expression: expression,
          });
        }
      },
    }),
  ];
}

// Helper functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(ext: string): string {
  const types: Record<string, string> = {
    pdf: 'PDF Document',
    docx: 'Word Document',
    doc: 'Word Document',
    md: 'Markdown',
    markdown: 'Markdown',
    txt: 'Plain Text',
    js: 'JavaScript',
    ts: 'TypeScript',
    jsx: 'React JSX',
    tsx: 'React TSX',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
  };
  return types[ext] || 'Unknown';
}

async function findSimilarFiles(workspacePath: string, requestedPath: string, limit: number = 5): Promise<string[]> {
  const requestedName = basename(requestedPath).toLowerCase();
  const requestedStem = requestedName.replace(/\.[^.]+$/, '');
  const requestedExt = extname(requestedName);
  const candidates: Array<{ path: string; score: number }> = [];

  const walk = async (dir: string) => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
        continue;
      }

      const relPath = relative(workspacePath, fullPath);
      const fileName = entry.name.toLowerCase();
      const fileStem = fileName.replace(/\.[^.]+$/, '');
      const fileExt = extname(fileName);

      let score = 0;
      if (fileName === requestedName) score += 100;
      if (fileStem === requestedStem) score += 70;
      if (fileName.includes(requestedStem) || requestedStem.includes(fileStem)) score += 40;
      if (requestedExt && fileExt === requestedExt) score += 20;

      if (score > 0) {
        candidates.push({ path: relPath, score });
      }
    }
  };

  await walk(workspacePath);
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return candidates.slice(0, limit).map((c) => c.path);
}
