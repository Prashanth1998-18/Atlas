import * as fs from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { IndexingPipeline } from '../indexing/pipeline.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import { LanceDBStorage } from '../storage/lancedb.js';
import {
  MAX_VISION_MIGRATION_RETRIES,
  PDF_VISION_EXTRACTION_VERSION,
  isVisionExtractionEnabled,
} from '../indexing/extraction/constants.js';

interface FileInfo {
  path: string;
  hash: string;
  lastModified: number;
}

interface IndexingResult {
  indexed: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

interface WorkspaceDocumentInfo {
  path: string;
  name: string;
  modified_at: number | null;
  created_at: number | null;
}

type IndexingProgressType =
  | 'start'
  | 'file_start'
  | 'file_progress'
  | 'file_done'
  | 'complete'
  | 'error';

type IndexingFileStatus = 'processing' | 'done' | 'skipped' | 'error';

export interface WorkspaceIndexingFileProgress {
  path: string;
  index: number;
  total: number;
  progress: number;
  status: IndexingFileStatus;
  stage?: string;
}

export interface WorkspaceIndexingProgress {
  type: IndexingProgressType;
  message: string;
  total_files: number;
  processed_files: number;
  indexed: number;
  updated: number;
  deleted: number;
  skipped: number;
  file?: WorkspaceIndexingFileProgress;
}

const CHAT_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.xlsx',
  '.xls',
]);

export class WorkspaceManager {
  public workspacePath: string;
  private sqlite: SQLiteStorage;
  private lancedb: LanceDBStorage;
  private pipeline: IndexingPipeline;
  private isIndexing: boolean = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.sqlite = new SQLiteStorage(workspacePath);
    this.lancedb = new LanceDBStorage(workspacePath);
    this.pipeline = new IndexingPipeline(workspacePath, this.sqlite, this.lancedb);
  }

  private parseDocumentMetadata(metadata: unknown): Record<string, unknown> {
    if (!metadata) return {};
    if (typeof metadata === 'object') {
      return metadata as Record<string, unknown>;
    }
    if (typeof metadata === 'string') {
      try {
        const parsed = JSON.parse(metadata) as unknown;
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private shouldMigratePdf(existingDoc: Record<string, unknown>, relativePath: string): boolean {
    if (!isVisionExtractionEnabled()) return false;
    // Defer migration until credentials exist; avoids repeat fallback re-index loops.
    if (!process.env.OPENAI_API_KEY) return false;
    if (extname(relativePath).toLowerCase() !== '.pdf') return false;

    const metadata = this.parseDocumentMetadata(existingDoc.metadata);
    const extractionVersion = String(metadata.extraction_version || '');
    if (extractionVersion !== PDF_VISION_EXTRACTION_VERSION) {
      return true;
    }

    const extractionEngine = String(metadata.extraction_engine || '');
    if (extractionEngine === 'vision') {
      return false;
    }

    // Allow bounded retries for docs that previously fell back from vision to text.
    if (extractionEngine === 'text') {
      const retryExhausted = Boolean(metadata.vision_retry_exhausted);
      if (retryExhausted) {
        return false;
      }

      const retryCount = Number(metadata.vision_retry_count);
      const safeRetryCount = Number.isFinite(retryCount) ? retryCount : 0;
      if (safeRetryCount >= MAX_VISION_MIGRATION_RETRIES) {
        return false;
      }

      const nextRetryAt = Number(metadata.vision_next_retry_at);
      const safeNextRetryAt = Number.isFinite(nextRetryAt) ? nextRetryAt : 0;
      if (safeNextRetryAt > Date.now()) {
        return false;
      }

      const fallbackReason = String(metadata.fallback_reason || '').toLowerCase();
      return (
        fallbackReason.includes('vision') ||
        fallbackReason.includes('pdf conversion') ||
        safeRetryCount > 0
      );
    }

    return false;
  }

  private clampProgress(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private inferFileProgress(stageMessage: string): number {
    const message = stageMessage.toLowerCase();

    if (message.includes('parsing')) return 12;
    if (message.includes('converting pdf pages')) return 18;
    if (message.includes('prepared') && message.includes('page image')) return 28;
    if (message.includes('falling back to text parser')) return 62;
    if (message.includes('chunking')) return 82;
    if (message.includes('embedding')) return 90;
    if (message.includes('saving')) return 96;
    if (message.includes('indexed') || message.includes('scanned')) return 100;

    const extracting = /vision extracting page (\d+)\/(\d+)/i.exec(stageMessage);
    if (extracting) {
      const page = Number(extracting[1]);
      const total = Number(extracting[2]);
      if (total > 0) {
        return this.clampProgress(30 + ((page - 1) / total) * 50);
      }
    }

    const extracted = /vision extracted page (\d+)\/(\d+)/i.exec(stageMessage);
    if (extracted) {
      const page = Number(extracted[1]);
      const total = Number(extracted[2]);
      if (total > 0) {
        return this.clampProgress(30 + (page / total) * 50);
      }
    }

    return 55;
  }

  private buildProgressPayload(
    type: IndexingProgressType,
    message: string,
    totals: {
      totalFiles: number;
      processedFiles: number;
      indexed: number;
      updated: number;
      deleted: number;
      skipped: number;
    },
    file?: Omit<WorkspaceIndexingFileProgress, 'progress'> & { progress?: number }
  ): WorkspaceIndexingProgress {
    return {
      type,
      message,
      total_files: totals.totalFiles,
      processed_files: totals.processedFiles,
      indexed: totals.indexed,
      updated: totals.updated,
      deleted: totals.deleted,
      skipped: totals.skipped,
      file: file
        ? {
            ...file,
            progress: this.clampProgress(file.progress ?? 0),
          }
        : undefined,
    };
  }

  /**
   * List all supported files in the workspace.
   */
  async listSupportedFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const res = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
              await walk(res);
            }
          } else {
            if (IndexingPipeline.isSupported(res)) {
              files.push(res);
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    await walk(this.workspacePath);
    return files;
  }

  /**
   * List workspace documents for chat UI, including modified/created timestamps.
   * Results are sorted by most recently modified (fallback to created time).
   */
  async listWorkspaceDocuments(): Promise<WorkspaceDocumentInfo[]> {
    const docs: WorkspaceDocumentInfo[] = [];
    const IGNORED_DIRS = new Set(['.git', 'node_modules', '.atlas', '__pycache__', '.venv', 'target', 'dist', 'build']);

    const walk = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;

          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
            continue;
          }

          if (!entry.isFile()) continue;

          const ext = extname(entry.name).toLowerCase();
          if (!CHAT_DOCUMENT_EXTENSIONS.has(ext)) continue;

          try {
            const stats = await fs.stat(fullPath);
            docs.push({
              path: fullPath,
              name: basename(fullPath),
              modified_at: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
              created_at: Number.isFinite(stats.birthtimeMs) ? stats.birthtimeMs : null,
            });
          } catch {
            docs.push({
              path: fullPath,
              name: basename(fullPath),
              modified_at: null,
              created_at: null,
            });
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    await walk(this.workspacePath);

    docs.sort((a, b) => {
      const aRecency = a.modified_at ?? a.created_at ?? 0;
      const bRecency = b.modified_at ?? b.created_at ?? 0;
      if (aRecency !== bRecency) return bRecency - aRecency;
      return a.name.localeCompare(b.name);
    });

    return docs;
  }

  /**
   * Generate a manifest of the workspace for the agent's context.
   */
  async generateManifest(): Promise<string> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const res = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
              await walk(res);
            }
          } else {
            files.push(relative(this.workspacePath, res));
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    await walk(this.workspacePath);
    
    const indexedDocs = this.sqlite.listDocuments() as any[];
    const indexedPaths = new Set(indexedDocs.map(d => d.path));
    
    return `
<workspace>
  <path>${this.workspacePath}</path>
  <files count="${files.length}" indexed="${indexedDocs.length}">
${files.map(f => {
  const fullPath = join(this.workspacePath, f);
  const isIndexed = indexedPaths.has(fullPath);
  return `    <file indexed="${isIndexed}">${f}</file>`;
}).join('\n')}
  </files>
</workspace>`;
  }

  /**
   * Get file info including content hash for change detection.
   */
  private async getFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const stats = await fs.stat(filePath);
      // For change detection, we use mtime as a quick check
      // The actual content hash is computed during indexing
      return {
        path: filePath,
        hash: '', // Will be computed during indexing
        lastModified: stats.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  /**
   * Smart indexing: only index new or changed files, remove deleted ones.
   */
  async indexWorkspace(onProgress?: (progress: WorkspaceIndexingProgress) => void): Promise<IndexingResult> {
    if (this.isIndexing) {
      return { indexed: 0, updated: 0, deleted: 0, skipped: 0, errors: ['Scanning already in progress'] };
    }

    this.isIndexing = true;
    const result: IndexingResult = { indexed: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };

    try {
      // Get all current files in workspace (absolute paths)
      const currentFilesAbsolute = await this.listSupportedFiles();
      const totalFiles = currentFilesAbsolute.length;
      let processedFiles = 0;

      const totals = () => ({
        totalFiles,
        processedFiles,
        indexed: result.indexed,
        updated: result.updated,
        deleted: result.deleted,
        skipped: result.skipped,
      });

      onProgress?.(
        this.buildProgressPayload(
          'start',
          `Scanning started: ${totalFiles} file(s)`,
          totals()
        )
      );
      
      // Convert to relative paths for comparison with stored paths
      const currentFilesRelative = new Set(
        currentFilesAbsolute.map(f => relative(this.workspacePath, f))
      );

      // Get all indexed documents from SQLite (now stores relative paths)
      const indexedDocs = this.sqlite.listDocuments() as any[];
      const indexedByRelativePath = new Map<string, any>();
      for (const doc of indexedDocs) {
        indexedByRelativePath.set(doc.path, doc);
      }

      // 1. Delete documents that no longer exist
      for (const doc of indexedDocs) {
        if (!currentFilesRelative.has(doc.path)) {
          try {
            onProgress?.(
              this.buildProgressPayload(
                'file_progress',
                `Removing deleted file: ${doc.path}`,
                totals()
              )
            );
            await this.lancedb.deleteByDocument(doc.id);
            this.sqlite.deleteDocument(doc.id);
            result.deleted++;
          } catch (error: any) {
            result.errors.push(`Failed to delete ${doc.path}: ${error.message}`);
          }
        }
      }

      // 2. Index new or changed files
      for (const absolutePath of currentFilesAbsolute) {
        const relativePath = relative(this.workspacePath, absolutePath);
        const existingDoc = indexedByRelativePath.get(relativePath);
        const fileIndex = processedFiles + 1;
        let finalStatus: IndexingFileStatus = 'done';
        let finalMessage = '';
        
        try {
          const stats = await fs.stat(absolutePath);
          
          // Check if file needs (re)indexing.
          // PDFs can be force-updated one time when extraction_version is old.
          if (existingDoc) {
            const needsPdfMigration = this.shouldMigratePdf(existingDoc, relativePath);

            // File exists in index - check if it changed or needs one-time PDF migration
            if (stats.mtimeMs <= existingDoc.last_modified && !needsPdfMigration) {
              // File hasn't changed, skip
              result.skipped++;
              finalStatus = 'skipped';
              finalMessage = `Skipped unchanged file: ${relativePath}`;
            } else {
              // File changed - delete old chunks and re-index
              finalMessage = needsPdfMigration
                ? `Migrating PDF extraction: ${relativePath}`
                : `Updating: ${relativePath}`;

              onProgress?.(
                this.buildProgressPayload(
                  'file_start',
                  finalMessage,
                  totals(),
                  {
                    path: relativePath,
                    index: fileIndex,
                    total: totalFiles,
                    progress: 5,
                    status: 'processing',
                    stage: finalMessage,
                  }
                )
              );

              await this.lancedb.deleteByDocument(existingDoc.id);
              await this.pipeline.indexFile(absolutePath, {
                existingMetadata: this.parseDocumentMetadata(existingDoc.metadata),
                onProgress: (message) =>
                  onProgress?.(
                    this.buildProgressPayload(
                      'file_progress',
                      `[${fileIndex}/${totalFiles}] ${relativePath}: ${message}`,
                      totals(),
                      {
                        path: relativePath,
                        index: fileIndex,
                        total: totalFiles,
                        progress: this.inferFileProgress(message),
                        status: 'processing',
                        stage: message,
                      }
                    )
                  ),
              });
              result.updated++;
              finalMessage = `Updated: ${relativePath}`;
            }
          } else {
            // New file - index it
            finalMessage = `Scanning: ${relativePath}`;
            onProgress?.(
              this.buildProgressPayload(
                'file_start',
                finalMessage,
                totals(),
                {
                  path: relativePath,
                  index: fileIndex,
                  total: totalFiles,
                  progress: 5,
                  status: 'processing',
                  stage: finalMessage,
                }
              )
            );

            await this.pipeline.indexFile(absolutePath, {
              onProgress: (message) =>
                onProgress?.(
                  this.buildProgressPayload(
                    'file_progress',
                    `[${fileIndex}/${totalFiles}] ${relativePath}: ${message}`,
                    totals(),
                    {
                      path: relativePath,
                      index: fileIndex,
                      total: totalFiles,
                      progress: this.inferFileProgress(message),
                      status: 'processing',
                      stage: message,
                    }
                  )
                ),
            });
            result.indexed++;
            finalMessage = `Scanned: ${relativePath}`;
          }
        } catch (error: any) {
          result.errors.push(`Failed to index ${relativePath}: ${error.message}`);
          finalStatus = 'error';
          finalMessage = `Failed to index ${relativePath}: ${error.message}`;
        } finally {
          processedFiles++;
          onProgress?.(
            this.buildProgressPayload(
              'file_done',
              finalMessage || `Finished: ${relativePath}`,
              totals(),
              {
                path: relativePath,
                index: fileIndex,
                total: totalFiles,
                progress: 100,
                status: finalStatus,
                stage: finalMessage || `Finished: ${relativePath}`,
              }
            )
          );
        }
      }

      onProgress?.(
        this.buildProgressPayload(
          'complete',
          `Scan complete: ${result.indexed} new, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged`,
          totals()
        )
      );
      
    } finally {
      this.isIndexing = false;
    }

    return result;
  }

  /**
   * Check if indexing is currently in progress.
   */
  isIndexingInProgress(): boolean {
    return this.isIndexing;
  }

  /**
   * Get indexing status.
   */
  getIndexingStatus(): { total: number; indexed: number; inProgress: boolean } {
    const docs = this.sqlite.listDocuments();
    return {
      total: docs.length,
      indexed: docs.length,
      inProgress: this.isIndexing,
    };
  }

  getSqlite() { return this.sqlite; }
  getLanceDB() { return this.lancedb; }
}
