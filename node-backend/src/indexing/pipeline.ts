import * as fs from 'node:fs/promises';
import { extname, basename, relative } from 'node:path';
import { ParserRegistry } from './parsers/index.js';
import { Chunker } from './chunker.js';
import { Embedder } from './embedder.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import { LanceDBStorage } from '../storage/lancedb.js';
import { createHash } from 'node:crypto';

export class IndexingPipeline {
  private chunker: Chunker;
  private embedder: Embedder;
  private sqlite: SQLiteStorage;
  private lancedb: LanceDBStorage;
  private workspacePath: string;

  constructor(workspacePath: string, sqlite: SQLiteStorage, lancedb: LanceDBStorage) {
    this.chunker = new Chunker();
    this.embedder = new Embedder();
    this.sqlite = sqlite;
    this.lancedb = lancedb;
    this.workspacePath = workspacePath;
  }

  async indexFile(
    filePath: string,
    options: { onProgress?: (message: string) => void; existingMetadata?: Record<string, unknown> } = {}
  ) {
    const ext = extname(filePath).toLowerCase();

    try {
      // Use the parser registry to handle all supported file types
      options.onProgress?.('Parsing document');
      const parseResult = await ParserRegistry.parse(filePath, {
        onProgress: options.onProgress,
        existingMetadata: options.existingMetadata,
      });
      
      if (!parseResult) {
        console.error(`Unsupported or failed to parse: ${filePath}`);
        return;
      }

      const { text, metadata: parseMetadata } = parseResult;
      
      if (!text || text.trim().length === 0) {
        console.error(`No content extracted from: ${filePath}`);
        return;
      }

      const fileHash = createHash('sha256').update(text).digest('hex');
      const stats = await fs.stat(filePath);
      
      const docId = fileHash.substring(0, 16);
      options.onProgress?.('Chunking content');
      const chunks = this.chunker.splitText(text, { docId, path: filePath, ...parseMetadata });
      
      if (chunks.length === 0) {
        console.error(`No chunks created for: ${filePath}`);
        return;
      }

      const textsToEmbed = chunks.map(c => c.content);
      options.onProgress?.(`Embedding ${chunks.length} chunk(s)`);
      const vectors = await this.embedder.embedTexts(textsToEmbed);

      // Convert absolute path to relative path for storage
      // This ensures consistency when read_file joins workspacePath + doc_path
      const relativePath = relative(this.workspacePath, filePath);

      // Normalize chunks for LanceDB - use fixed schema to avoid field conflicts
      const lancedbChunks = chunks.map((c, i) => ({
        id: `${docId}-${i}`,
        document_id: docId,
        text: c.content,
        vector: vectors[i],
        doc_path: relativePath,  // Store relative path, not absolute
        chunk_index: i,
        // Store variable metadata as JSON string to avoid schema conflicts
        metadata_json: JSON.stringify(c.metadata || {}),
      }));

      options.onProgress?.('Saving index data');
      await this.lancedb.insertChunks(lancedbChunks);
      
      this.sqlite.saveDocument({
        id: docId,
        path: relativePath,  // Also store relative path in SQLite
        filename: basename(filePath),
        fileType: ext,
        fileHash,
        fileSize: stats.size,
        lastModified: stats.mtimeMs,
        metadata: parseMetadata || {}
      });
      options.onProgress?.('Scanned');

      console.error(`Indexed ${filePath} (${chunks.length} chunks)`);
    } catch (error: any) {
      console.error(`Error indexing ${filePath}: ${error.message}`);
    }
  }

  /**
   * Check if a file is supported for indexing.
   */
  static isSupported(filePath: string): boolean {
    const ext = extname(filePath);
    return ParserRegistry.isSupported(ext);
  }

  /**
   * Get all supported extensions.
   */
  static getSupportedExtensions(): string[] {
    return ParserRegistry.getSupportedExtensions();
  }
}
