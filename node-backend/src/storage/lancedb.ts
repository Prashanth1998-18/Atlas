import * as lancedb from '@lancedb/lancedb';
import { join } from 'node:path';

export class LanceDBStorage {
  private dbPath: string;
  private table_name = 'chunks';
  private tableCache: any = null;

  constructor(workspacePath: string) {
    this.dbPath = join(workspacePath, '.atlas', 'vectors');
  }

  async connect() {
    return await lancedb.connect(this.dbPath);
  }

  /**
   * Get or create the chunks table.
   * Caches the table reference to avoid repeated lookups.
   */
  private async getTable(db: any): Promise<any> {
    if (this.tableCache) {
      return this.tableCache;
    }

    // Check if table exists by listing tables
    const tables = await db.tableNames();
    
    if (tables.includes(this.table_name)) {
      this.tableCache = await db.openTable(this.table_name);
    }
    
    return this.tableCache;
  }

  async insertChunks(chunks: any[]) {
    if (!chunks || chunks.length === 0) {
      return;
    }

    const db = await this.connect();
    let table = await this.getTable(db);
    
    if (table) {
      // Table exists, add to it
      await table.add(chunks);
    } else {
      // Table doesn't exist, create it with the first batch
      this.tableCache = await db.createTable(this.table_name, chunks);
    }
  }

  async search(vector: number[], limit: number = 10, filter?: string) {
    const db = await this.connect();
    
    // Check if table exists
    const tables = await db.tableNames();
    if (!tables.includes(this.table_name)) {
      return []; // No table means no results
    }
    
    const table = await db.openTable(this.table_name);
    let query = table.vectorSearch(vector).limit(limit);
    if (filter) {
      query = query.where(filter);
    }
    return await query.toArray();
  }

  async deleteByDocument(documentId: string) {
    const db = await this.connect();
    
    // Check if table exists
    const tables = await db.tableNames();
    if (!tables.includes(this.table_name)) {
      return; // Nothing to delete
    }
    
    const table = await db.openTable(this.table_name);
    await table.delete(`document_id = "${documentId}"`);
    
    // Invalidate cache since we modified the table
    this.tableCache = null;
  }

  /**
   * Check if the vector database has any data.
   */
  async hasData(): Promise<boolean> {
    const db = await this.connect();
    const tables = await db.tableNames();
    return tables.includes(this.table_name);
  }

  /**
   * Clear all data from the vector database.
   */
  async clear(): Promise<void> {
    const db = await this.connect();
    const tables = await db.tableNames();
    if (tables.includes(this.table_name)) {
      await db.dropTable(this.table_name);
    }
    this.tableCache = null;
  }
}
