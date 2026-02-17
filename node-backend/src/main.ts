import * as readline from 'node:readline';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { WorkspaceManager, type WorkspaceIndexingProgress } from './workspace/manager.js';
import { AtlasAgent } from './agent/index.js';
import { saveDocumentToWorkspace, type DocumentFormat } from './documents/save.js';

dotenv.config({ path: join(process.cwd(), '..', '.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

console.error('Atlas Node Backend ready');

let workspaceManager: WorkspaceManager | null = null;
let agent: AtlasAgent | null = null;
let queuedPostSaveScanInterval: NodeJS.Timeout | null = null;

function requireOpenWorkspace(requestedWorkspaceId?: string): WorkspaceManager {
  if (!workspaceManager) {
    throw new Error('Workspace not open');
  }
  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceManager.workspacePath) {
    throw new Error('Requested workspace does not match currently open workspace');
  }
  return workspaceManager;
}

function resolveWorkspacePath(manager: WorkspaceManager, unsafePath: string): string {
  if (!unsafePath) {
    throw new Error('Path is required');
  }

  const root = resolve(manager.workspacePath);
  const candidate = isAbsolute(unsafePath) ? resolve(unsafePath) : resolve(root, unsafePath);

  const compareRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const compareCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const relativePath = relative(compareRoot, compareCandidate);

  const isInsideWorkspace =
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));

  if (!isInsideWorkspace) {
    throw new Error('Path is outside workspace');
  }

  return candidate;
}

interface RpcRequest {
  method: string;
  params: Record<string, unknown>;
  id: string;
}

function sendResponse(id: string, result: unknown): void {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  }) + '\n');
}

function sendError(message: string): void {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message
    }
  }) + '\n');
}

function sendStreamNotification(id: string, part: unknown): void {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'chat.stream',
    params: { id, part }
  }) + '\n');
}

function sendIndexingNotification(message: string, progress?: WorkspaceIndexingProgress): void {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'indexing.progress',
    params: { message, progress }
  }) + '\n');
}

function triggerBackgroundScan(manager: WorkspaceManager, reason: string): void {
  const startScan = () => {
    console.error(`[Scan] Triggered background scan (${reason})`);
    void manager
      .indexWorkspace((progress) => {
        console.error(`[Scan] ${progress.message}`);
        sendIndexingNotification(progress.message, progress);
      })
      .then((indexResult) => {
        console.error(
          `Scan complete: ${indexResult.indexed} new, ${indexResult.updated} updated, ${indexResult.deleted} removed`
        );
      })
      .catch((error) => {
        const message = String((error as { message?: unknown })?.message || error || 'Unknown scan error');
        console.error(`Scan failed: ${message}`);
        sendIndexingNotification(`Scan failed: ${message}`);
      });
  };

  if (!manager.isIndexingInProgress()) {
    startScan();
    return;
  }

  if (queuedPostSaveScanInterval) {
    return;
  }

  let checks = 0;
  queuedPostSaveScanInterval = setInterval(() => {
    checks += 1;
    if (!manager.isIndexingInProgress()) {
      if (queuedPostSaveScanInterval) {
        clearInterval(queuedPostSaveScanInterval);
        queuedPostSaveScanInterval = null;
      }
      startScan();
      return;
    }

    // Stop polling after ~5 minutes; next user-triggered refresh/scan will pick up changes.
    if (checks >= 300) {
      if (queuedPostSaveScanInterval) {
        clearInterval(queuedPostSaveScanInterval);
        queuedPostSaveScanInterval = null;
      }
    }
  }, 1000);
}

async function handleRequest(request: RpcRequest): Promise<unknown> {
  const { method, params, id } = request;

  switch (method) {
    case 'ping':
      return 'pong';

    case 'workspace_open': {
      const workspacePath = params.path as string;
      const isSameWorkspace = workspaceManager?.workspacePath === workspacePath;
      if (!workspaceManager || !isSameWorkspace) {
        workspaceManager = new WorkspaceManager(workspacePath);
      }

      if (!agent || !isSameWorkspace) {
        agent = new AtlasAgent('gpt-5.2', workspacePath, workspaceManager.getLanceDB(), workspaceManager.getSqlite());
      }

      const indexedDocs = workspaceManager.getSqlite().listDocuments();

      if (!workspaceManager.isIndexingInProgress()) {
        console.error('Starting workspace scan...');

        void workspaceManager.indexWorkspace((progress) => {
          console.error(`[Scan] ${progress.message}`);
          sendIndexingNotification(progress.message, progress);
        }).then((indexResult) => {
          console.error(
            `Scan complete: ${indexResult.indexed} new, ${indexResult.updated} updated, ${indexResult.deleted} removed`
          );
        }).catch((error) => {
          const message = String((error as { message?: unknown })?.message || error || 'Unknown scan error');
          console.error(`Scan failed: ${message}`);
          sendIndexingNotification(`Scan failed: ${message}`);
        });
      }

      return { 
        workspace_id: workspacePath,
        // Return immediately using known indexed count; full totals stream via scan progress events.
        document_count: indexedDocs.length,
        indexed_count: indexedDocs.length,
        is_indexing: workspaceManager.isIndexingInProgress(),
        indexing_result: null
      };
    }

    case 'workspace_status': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const status = manager.getIndexingStatus();
      return { 
        total_count: status.total,
        indexed_count: status.indexed,
        in_progress: status.inProgress
      };
    }

    case 'workspace_list_documents': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const documents = await manager.listWorkspaceDocuments();
      return { documents };
    }

    case 'workspace_list_directory': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const directoryPath = params.directory_path as string;
      const resolvedPath = resolveWorkspacePath(manager, directoryPath);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      return {
        entries: entries.map((entry) => ({
          name: entry.name,
          path: join(resolvedPath, entry.name),
          is_directory: entry.isDirectory(),
          is_file: entry.isFile(),
        })),
      };
    }

    case 'workspace_read_file_bytes': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const filePath = params.file_path as string;
      const resolvedPath = resolveWorkspacePath(manager, filePath);
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error('Requested path is not a file');
      }
      const data = await fs.readFile(resolvedPath);
      return { data_base64: data.toString('base64') };
    }

    case 'search': {
      if (!workspaceManager) throw new Error('Workspace not open');
      const { Embedder } = await import('./indexing/embedder.js');
      const embedder = new Embedder();
      const vector = await embedder.embedText(params.query as string);
      const searchResults = await workspaceManager.getLanceDB().search(vector, (params.top_k as number) || 15);
      return {
        results: searchResults,
        total: searchResults.length
      };
    }

    case 'conversation_create':
      if (!workspaceManager) throw new Error('Workspace not open');
      return workspaceManager.getSqlite().createConversation(params.workspace_id as string, params.title as string | undefined);

    case 'conversation_list':
      if (!workspaceManager) throw new Error('Workspace not open');
      return { conversations: workspaceManager.getSqlite().listConversations(params.workspace_id as string) };

    case 'conversation_get':
      if (!workspaceManager) throw new Error('Workspace not open');
      return {
        conversation: workspaceManager.getSqlite().getConversation(params.conversation_id as string),
        messages: workspaceManager.getSqlite().listMessages(params.conversation_id as string).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at).toLocaleTimeString(),
          metadata: m.metadata,
        })),
      };

    case 'conversation_delete':
      if (!workspaceManager) throw new Error('Workspace not open');
      workspaceManager.getSqlite().deleteConversation(params.conversation_id as string);
      return { status: 'deleted' };

    // Note: conversation_add_message removed - LangGraph checkpoint handles message storage

    case 'conversation_update_title':
      if (!workspaceManager) throw new Error('Workspace not open');
      workspaceManager.getSqlite().updateConversationTitle(params.conversation_id as string, params.title as string);
      return { status: 'updated' };

    case 'conversation_history': {
      if (!workspaceManager) throw new Error('Workspace not open');
      const threadId = params.conversation_id as string;
      const messages = workspaceManager.getSqlite().listMessages(threadId);
      return {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at).toLocaleTimeString(),
          metadata: m.metadata,
        })),
      };
    }

    case 'document_preview': {
      // Read and parse a document for preview (supports PDF, DOCX, etc.)
      const filePath = params.path as string;
      if (!filePath) throw new Error('path is required');
      
      const { extname } = await import('node:path');
      const ext = extname(filePath).toLowerCase().slice(1); // Remove the dot
      
      try {
        let content: string;
        
        if (ext === 'pdf') {
          const { parsePdf } = await import('./indexing/parsers/pdf.js');
          content = await parsePdf(filePath);
        } else if (ext === 'docx') {
          const { parseDocx } = await import('./indexing/parsers/docx.js');
          content = await parseDocx(filePath);
        } else if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'json' || ext === 'html') {
          content = await fs.readFile(filePath, 'utf-8');
        } else {
          throw new Error(`Unsupported file type: .${ext}`);
        }
        
        const filename = filePath.split(/[/\\]/).pop() || 'unknown';
        
        return {
          content,
          file_type: ext,
          filename,
          can_preview: true
        };
      } catch (error: any) {
        console.error(`[Preview] Error reading ${filePath}:`, error.message);
        throw new Error(`Failed to read document: ${error.message}`);
      }
    }

    case 'document_get_active_draft': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const conversationId = String(params.conversation_id || '').trim();
      if (!conversationId) throw new Error('conversation_id is required');

      const draft = manager.getSqlite().getActiveDocumentDraft(conversationId);
      return { draft };
    }

    case 'document_discard_draft': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const conversationId = String(params.conversation_id || '').trim();
      if (!conversationId) throw new Error('conversation_id is required');

      const draftId = String(params.draft_id || '').trim();
      const discarded = draftId
        ? manager.getSqlite().setDocumentDraftStatus(draftId, 'discarded', { discarded_at: Date.now() })
        : manager.getSqlite().discardActiveDocumentDraft(conversationId);

      return {
        status: 'discarded',
        draft: discarded || null,
      };
    }

    case 'document_save': {
      const manager = requireOpenWorkspace(params.workspace_id as string | undefined);
      const conversationId = String(params.conversation_id || '').trim();
      if (!conversationId) throw new Error('conversation_id is required');

      const filename = String(params.filename || '').trim();
      const content = String(params.content || '');
      const location = String(params.location || '');
      const format = String(params.format || 'md').toLowerCase() as DocumentFormat;
      const draftId = String(params.draft_id || '').trim();

      if (!filename) throw new Error('filename is required');
      if (!content.trim()) throw new Error('content is required');
      if (!['md', 'docx', 'txt'].includes(format)) {
        throw new Error('format must be one of: md, docx, txt');
      }

      const saved = await saveDocumentToWorkspace({
        workspacePath: manager.workspacePath,
        filename,
        content,
        location,
        format,
      });

      let savedDraft = null;
      if (draftId) {
        savedDraft = manager.getSqlite().setDocumentDraftStatus(draftId, 'saved', {
          saved_path: saved.relative_path,
          saved_format: saved.format,
          fallback_to_md: saved.fallback_to_md,
        });
      }
      if (!savedDraft) {
        savedDraft = manager.getSqlite().saveActiveDocumentDraft(conversationId, {
          saved_path: saved.relative_path,
          saved_format: saved.format,
          fallback_to_md: saved.fallback_to_md,
        });
      }

      const indexingQueued = manager.isIndexingInProgress();
      triggerBackgroundScan(manager, `saved document: ${saved.relative_path}`);

      const parts: string[] = [];
      parts.push(`Saved ${saved.filename} to ${saved.location}`);
      if (saved.fallback_to_md) {
        parts.push('DOCX conversion failed, so the file was saved as Markdown.');
      }
      if (saved.location_fallback_to_root) {
        parts.push('Requested folder was invalid, so it was saved to workspace root.');
      }
      parts.push(indexingQueued ? 'Scan queued after current scan completes.' : 'Scanning started.');

      return {
        ...saved,
        indexing_queued: indexingQueued,
        message: parts.join(' '),
      };
    }

    case 'chat': {
      if (!agent || !workspaceManager) throw new Error('Workspace not open');
      const message = params.message as string;
      const conversationId = params.conversation_id as string;
      const pinnedDocs = (params.pinned_docs as string[]) || [];
      // Accept both snake_case (Rust/Tauri) and camelCase (frontend) flags
      // Ensure boolean conversion (handle string "true"/"false" from Tauri)
      const isRetry = Boolean((params.is_retry ?? (params as any).isRetry) ?? false);
      const isEdit = Boolean((params.is_edit ?? (params as any).isEdit) ?? false);
      const manifest = await workspaceManager.generateManifest();
      
      if (!conversationId) {
        throw new Error('conversation_id is required for chat');
      }
      
      let fullResponse = '';
      let plan: unknown = null;

      try {
        // Pass conversation_id as thread_id and pinned_docs for primary context
        const responseStream = await agent.run(message, manifest, conversationId, pinnedDocs, isRetry, isEdit);
        
        for await (const part of responseStream) {
          sendStreamNotification(id, part);

          if (part.type === 'text') {
            fullResponse = part.content; // LangGraph sends full message each time
          } else if (part.type === 'tool-call' && part.toolName === 'todo_write') {
            try {
              const args = typeof part.args === 'string' ? JSON.parse(part.args) : part.args;
              plan = { steps: args.todos, status: 'executing' };
            } catch {
              // Ignore parse errors
            }
          }
        }
      } catch (error: any) {
        console.error('Agent error:', error.message);
        return {
          response: `Error: ${error.message}`,
          sources: [],
          plan: null
        };
      }

      // Update conversation last_message_at timestamp
      workspaceManager.getSqlite().updateConversationLastMessage(conversationId);

      return { 
        response: fullResponse,
        sources: [],
        plan
      };
    }

    default:
      console.error(`Method not handled: ${method}`);
      return { status: 'ok' };
  }
}

rl.on('line', async (line: string) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line) as RpcRequest;
    const result = await handleRequest(request);
    
    if (result) {
      sendResponse(request.id, result);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error processing request: ${message}`);
    sendError(message);
  }
});

process.on('SIGINT', () => {
  process.exit(0);
});
