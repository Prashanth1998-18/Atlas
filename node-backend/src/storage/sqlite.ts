import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

interface DocumentRecord {
  id: string;
  path: string;
  filename: string;
  fileType: string;
  fileHash: string;
  fileSize: number;
  lastModified: number;
  metadata?: Record<string, unknown>;
}

interface ConversationRecord {
  id: string;
  workspace_id: string;
  title: string;
  created_at: number;
  last_message_at: number;
}

type Role = 'user' | 'assistant' | 'tool';

interface MessageRecord {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: number;
  turn_index: number;
  metadata?: Record<string, unknown>;
}

interface SummaryRecord {
  conversation_id: string;
  summary: string;
  archived_upto_turn: number;
  updated_at: number;
}

export type DocumentDraftStatus = 'active' | 'discarded' | 'saved';

export interface DocumentDraftRecord {
  id: string;
  conversation_id: string;
  filename: string;
  content: string;
  location: string;
  status: DocumentDraftStatus;
  created_at: number;
  updated_at: number;
  metadata?: Record<string, unknown>;
}

// Messages are now stored in LangGraph's checkpoint database
// We only keep conversation metadata here for workspace association

export class SQLiteStorage {
  private db: Database.Database;

  constructor(workspacePath: string) {
    const dbPath = join(workspacePath, '.atlas', 'metadata.db');
    const dbDir = dirname(dbPath);
    
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        turn_index INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation ON conversation_messages(conversation_id, turn_index);

      CREATE TABLE IF NOT EXISTS conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        archived_upto_turn INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS conversation_document_drafts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_document_drafts_conversation_status
      ON conversation_document_drafts(conversation_id, status, updated_at DESC);
    `);
    
    // Note: messages table removed - LangGraph checkpoint handles message storage
  }

  saveDocument(doc: DocumentRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents 
      (id, path, filename, file_type, file_hash, file_size, last_modified, indexed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      doc.id,
      doc.path,
      doc.filename,
      doc.fileType,
      doc.fileHash,
      doc.fileSize,
      doc.lastModified,
      Date.now(),
      JSON.stringify(doc.metadata || {})
    );
  }

  getDocument(id: string): unknown {
    return this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  }

  getDocumentByPath(path: string): unknown {
    return this.db.prepare('SELECT * FROM documents WHERE path = ?').get(path);
  }

  listDocuments(): unknown[] {
    return this.db.prepare('SELECT * FROM documents').all();
  }

  deleteDocument(id: string): void {
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }

  createConversation(workspaceId: string, title?: string): { id: string; workspace_id: string; title: string } {
    const id = uuidv4();
    const now = Date.now();
    const conversationTitle = title || 'New Conversation';
    
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, workspace_id, title, created_at, last_message_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, workspaceId, conversationTitle, now, now);
    
    return { id, workspace_id: workspaceId, title: conversationTitle };
  }

  listConversations(workspaceId: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM conversations WHERE workspace_id = ? ORDER BY last_message_at DESC')
      .all(workspaceId);
  }

  getConversation(id: string): ConversationRecord | null {
    const conversation = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRecord | undefined;
    return conversation || null;
    // Note: Messages are now retrieved from LangGraph checkpoint, not from this table
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  updateConversationTitle(id: string, title: string): void {
    this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
  }

  updateConversationLastMessage(id: string): void {
    const now = Date.now();
    this.db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, id);
  }

  private parseDraftRow(row: any): DocumentDraftRecord {
    return {
      id: String(row.id),
      conversation_id: String(row.conversation_id),
      filename: String(row.filename),
      content: String(row.content),
      location: String(row.location),
      status: String(row.status) as DocumentDraftStatus,
      created_at: Number(row.created_at) || Date.now(),
      updated_at: Number(row.updated_at) || Date.now(),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  createDocumentDraft(
    conversationId: string,
    filename: string,
    content: string,
    location: string,
    metadata?: Record<string, unknown>
  ): DocumentDraftRecord {
    const now = Date.now();
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO conversation_document_drafts
      (id, conversation_id, filename, content, location, status, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      conversationId,
      filename,
      content,
      location,
      now,
      now,
      JSON.stringify(metadata || {})
    );

    return {
      id,
      conversation_id: conversationId,
      filename,
      content,
      location,
      status: 'active',
      created_at: now,
      updated_at: now,
      metadata,
    };
  }

  getActiveDocumentDraft(conversationId: string): DocumentDraftRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM conversation_document_drafts
      WHERE conversation_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(conversationId) as any;
    return row ? this.parseDraftRow(row) : null;
  }

  getLatestDocumentDraft(conversationId: string): DocumentDraftRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM conversation_document_drafts
      WHERE conversation_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(conversationId) as any;
    return row ? this.parseDraftRow(row) : null;
  }

  updateDocumentDraft(
    id: string,
    updates: {
      filename?: string;
      content?: string;
      location?: string;
      metadata?: Record<string, unknown>;
    }
  ): DocumentDraftRecord | null {
    const existing = this.db.prepare('SELECT * FROM conversation_document_drafts WHERE id = ?').get(id) as any;
    if (!existing) return null;

    const now = Date.now();
    const metadata = updates.metadata ?? (existing.metadata ? JSON.parse(existing.metadata) : {});
    this.db.prepare(`
      UPDATE conversation_document_drafts
      SET filename = ?, content = ?, location = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updates.filename ?? existing.filename,
      updates.content ?? existing.content,
      updates.location ?? existing.location,
      JSON.stringify(metadata || {}),
      now,
      id
    );

    const updated = this.db.prepare('SELECT * FROM conversation_document_drafts WHERE id = ?').get(id) as any;
    return updated ? this.parseDraftRow(updated) : null;
  }

  setDocumentDraftStatus(
    id: string,
    status: DocumentDraftStatus,
    metadata?: Record<string, unknown>
  ): DocumentDraftRecord | null {
    const existing = this.db.prepare('SELECT * FROM conversation_document_drafts WHERE id = ?').get(id) as any;
    if (!existing) return null;

    const now = Date.now();
    const mergedMetadata = {
      ...(existing.metadata ? JSON.parse(existing.metadata) : {}),
      ...(metadata || {}),
    };

    this.db.prepare(`
      UPDATE conversation_document_drafts
      SET status = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(status, JSON.stringify(mergedMetadata), now, id);

    const updated = this.db.prepare('SELECT * FROM conversation_document_drafts WHERE id = ?').get(id) as any;
    return updated ? this.parseDraftRow(updated) : null;
  }

  discardActiveDocumentDraft(conversationId: string): DocumentDraftRecord | null {
    const active = this.getActiveDocumentDraft(conversationId);
    if (!active) return null;
    return this.setDocumentDraftStatus(active.id, 'discarded', { discarded_at: Date.now() });
  }

  saveActiveDocumentDraft(
    conversationId: string,
    metadata?: Record<string, unknown>
  ): DocumentDraftRecord | null {
    const active = this.getActiveDocumentDraft(conversationId);
    if (!active) return null;
    return this.setDocumentDraftStatus(active.id, 'saved', {
      saved_at: Date.now(),
      ...(metadata || {}),
    });
  }

  // Conversation messages
  addMessage(message: Omit<MessageRecord, 'turn_index' | 'created_at'> & { turn_index?: number; created_at?: number }): MessageRecord {
    const now = Date.now();
    const lastTurn = this.db.prepare('SELECT MAX(turn_index) as max_turn FROM conversation_messages WHERE conversation_id = ?').get(message.conversation_id) as { max_turn: number | null };
    const turnIndex = message.turn_index ?? ((lastTurn.max_turn ?? -1) + 1);
    const createdAt = message.created_at ?? now;
    const record: MessageRecord = {
      ...message,
      created_at: createdAt,
      turn_index: turnIndex,
      metadata: message.metadata,
    };
    this.db.prepare(`
      INSERT OR REPLACE INTO conversation_messages (id, conversation_id, role, content, created_at, turn_index, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.conversation_id,
      record.role,
      record.content,
      record.created_at,
      record.turn_index,
      JSON.stringify(record.metadata || {})
    );
    return record;
  }

  listMessages(conversationId: string): MessageRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversation_messages 
      WHERE conversation_id = ? 
      ORDER BY turn_index ASC
    `).all(conversationId) as any[];
    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  deleteMessagesAfter(conversationId: string, turnIndex: number): void {
    this.db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ? AND turn_index > ?')
      .run(conversationId, turnIndex);
  }

  deleteLastAssistantTurn(conversationId: string): void {
    const row = this.db.prepare(`
      SELECT turn_index FROM conversation_messages 
      WHERE conversation_id = ? AND role IN ('assistant','tool')
      ORDER BY turn_index DESC LIMIT 1
    `).get(conversationId) as { turn_index: number } | undefined;
    if (!row) return;
    const turn = row.turn_index;
    this.db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ? AND turn_index = ?')
      .run(conversationId, turn);
  }

  // Summaries
  upsertSummary(summary: SummaryRecord): void {
    this.db.prepare(`
      INSERT INTO conversation_summaries (conversation_id, summary, archived_upto_turn, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        summary = excluded.summary,
        archived_upto_turn = excluded.archived_upto_turn,
        updated_at = excluded.updated_at
    `).run(
      summary.conversation_id,
      summary.summary,
      summary.archived_upto_turn,
      summary.updated_at
    );
  }

  getSummary(conversationId: string): SummaryRecord | null {
    const row = this.db.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?')
      .get(conversationId) as any;
    if (!row) return null;
    return {
      ...row,
      summary: row.summary,
      archived_upto_turn: row.archived_upto_turn,
      updated_at: row.updated_at,
    };
  }

  clearSummary(conversationId: string): void {
    this.db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?')
      .run(conversationId);
  }
}
