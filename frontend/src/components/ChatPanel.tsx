"use client";

import { useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { ArrowUp, ArrowDown, Plus, Paperclip, Check, Loader2, ChevronDown, ChevronRight, X, Edit2, RefreshCw, Copy, Search, BookOpen, FileText, Table, FileCode, FolderOpen, type LucideIcon } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import PlanView from "./PlanView";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Step taken by the assistant (tool call)
interface Step {
  id: string;
  description: string;
  status: "running" | "completed" | "error";
  startTime: number;
  endTime?: number;
}

// Helper: Format tool call into human-readable description
function formatToolDescription(toolName: string, args: Record<string, unknown>): string {
  const getFilename = (path: unknown): string => {
    if (!path || path === 'undefined') return '';
    if (typeof path !== 'string') return String(path);
    return path.split(/[/\\]/).pop() || path;
  };
  
  const truncate = (str: string, maxLen: number): string => {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  };
  
  const safeString = (val: unknown): string => {
    if (val === undefined || val === null || val === 'undefined') return '';
    return String(val);
  };

  switch (toolName) {
    case 'read_file': {
      const filename = getFilename(args.path);
      return filename ? `Reading ${filename}` : 'Reading file...';
    }
      
    case 'read_file_chunk': {
      const filename = getFilename(args.path);
      const startLine = args.start_line;
      const endLine = args.end_line;
      if (filename && startLine !== undefined && endLine !== undefined) {
        return `Reading ${filename} (lines ${startLine}-${endLine})`;
      } else if (filename) {
        return `Reading ${filename}`;
      }
      return 'Reading file...';
    }
      
    case 'grep_search': {
      const pattern = safeString(args.pattern);
      return pattern ? `Searching for "${truncate(pattern, 40)}"` : 'Searching...';
    }
      
    case 'hybrid_search': {
      const query = safeString(args.query);
      return query ? `Searching "${truncate(query, 40)}"` : 'Searching...';
    }
      
    case 'list_directory': {
      const path = args.path;
      if (path === '.' || path === '') return 'Listing workspace';
      const dirname = getFilename(path);
      return dirname ? `Listing ${dirname}` : 'Listing directory...';
    }
      
    case 'get_file_info': {
      const filename = getFilename(args.path);
      return filename ? `Checking ${filename}` : 'Checking file...';
    }
      
    case 'calculator': {
      const expr = safeString(args.expression);
      return expr ? `Calculating ${truncate(expr, 30)}` : 'Calculating...';
    }
      
    case 'todo_write':
      return 'Creating task list';
      
    case 'todo_read':
      return 'Checking task list';

    case 'create_document': {
      const filename = safeString(args.filename);
      return filename ? `Drafting ${truncate(filename, 40)}` : 'Drafting document...';
    }
      
    default:
      return `Using ${toolName}`;
  }
}

// Steps Dropdown Component
function StepsDropdown({ steps, isStreaming }: { steps: Step[], isStreaming: boolean }) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  
  useEffect(() => {
    if (isStreaming) setIsExpanded(true);
  }, [isStreaming]);
  
  if (steps.length === 0) return null;
  
  const completedCount = steps.filter(s => s.status === 'completed').length;
  const isWorking = steps.some(s => s.status === 'running');
  
  const headerText = isWorking 
    ? "Working..." 
    : `${completedCount} step${completedCount !== 1 ? 's' : ''} completed`;
  
  return (
    <div className="mb-3">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{headerText}</span>
      </button>
      
      {isExpanded && (
        <div className="mt-2 ml-1 border-l border-border pl-3 space-y-1.5">
          {steps.map(step => (
            <div key={step.id} className="flex items-center gap-2 text-xs">
              {step.status === 'running' ? (
                <Loader2 size={12} className="animate-spin text-primary flex-shrink-0" />
              ) : step.status === 'completed' ? (
                <Check size={12} className="text-green-500 flex-shrink-0" />
              ) : (
                <span className="w-3 h-3 text-red-500 flex-shrink-0">×</span>
              )}
              
              <span className="text-muted-foreground flex-1 truncate">{step.description}</span>
              
              {step.endTime && step.startTime && (
                <span className="text-muted-foreground/50 text-[10px] flex-shrink-0">
                  {((step.endTime - step.startTime) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface PlanStep {
  id: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

interface Plan {
  steps: PlanStep[];
  current_step: number | null;
  status: "planning" | "executing" | "synthesizing" | "completed";
  status_message: string | null;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Array<{ doc: string; page?: number }>;
  plan?: Plan;
  steps?: Step[];
  // Context stored with user messages for retry functionality
  pinnedDocs?: Array<{ path: string; name: string }>;
  mentionedDocs?: Array<{ path: string; name: string }>;
  textSelections?: Array<{ id: string; path: string; filename: string; text: string; lines?: [number, number]; page?: number }>;
}

interface PinnedDoc {
  path: string;
  name: string;
}

interface MentionedDoc {
  path: string;
  name: string;
}

interface WorkspaceDoc {
  path: string;
  name: string;
  modifiedAt?: number;
  createdAt?: number;
}

type SaveFormat = "md" | "docx" | "txt";

interface DocumentDraft {
  id: string;
  conversationId: string;
  filename: string;
  content: string;
  location: string;
  status: "active" | "discarded" | "saved";
  createdAt?: number;
  updatedAt?: number;
}

interface SaveDocumentResult {
  relative_path: string;
  filename: string;
  location: string;
  format: SaveFormat;
  fallback_to_md: boolean;
  indexing_queued: boolean;
  message: string;
}

interface ChatPanelProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function pickRecentDocuments(docs: WorkspaceDoc[], count: number): WorkspaceDoc[] {
  const ranked = [...docs].sort((a, b) => {
    const aRecency = a.modifiedAt ?? a.createdAt ?? 0;
    const bRecency = b.modifiedAt ?? b.createdAt ?? 0;
    if (aRecency !== bRecency) {
      return bRecency - aRecency;
    }
    return a.name.localeCompare(b.name);
  });
  return ranked.slice(0, count);
}

function getDocumentTypeMeta(filename: string): { Icon: LucideIcon; colorClass: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf") {
    return { Icon: FileText, colorClass: "text-red-500" };
  }
  if (ext === "doc" || ext === "docx") {
    return { Icon: FileText, colorClass: "text-blue-500" };
  }
  if (ext === "xls" || ext === "xlsx" || ext === "csv") {
    return { Icon: Table, colorClass: "text-green-500" };
  }
  if (ext === "md" || ext === "markdown") {
    return { Icon: FileCode, colorClass: "text-purple-500" };
  }
  return { Icon: FileText, colorClass: "text-slate-400" };
}

const LAST_FORMAT_STORAGE_KEY = "atlas-create-document-last-format";

function toWorkspaceRelativePath(selectedPath: string, workspacePath: string): string | null {
  const normalize = (value: string) =>
    value
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();

  const normalizedSelected = normalize(selectedPath);
  const normalizedWorkspace = normalize(workspacePath);

  if (normalizedSelected === normalizedWorkspace) {
    return ".";
  }

  const prefix = `${normalizedWorkspace}/`;
  if (!normalizedSelected.startsWith(prefix)) {
    return null;
  }

  const relativePath = selectedPath.slice(workspacePath.length).replace(/^[/\\]+/, "").replace(/\\/g, "/");
  return relativePath || ".";
}

function parseDraftFromToolResult(raw: unknown, fallbackConversationId: string | null): DocumentDraft | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as {
      status?: string;
      draft?: {
        id?: string;
        conversation_id?: string;
        filename?: string;
        content?: string;
        location?: string;
        status?: string;
        created_at?: number;
        updated_at?: number;
      };
    };

    const status = String(parsed?.status || "");
    if (status !== "created" && status !== "updated" && status !== "restored") return null;
    const draft = parsed.draft;
    if (!draft || typeof draft !== "object") return null;
    if (!draft.id || !draft.filename || !draft.content) return null;

    return {
      id: String(draft.id),
      conversationId: String(draft.conversation_id || fallbackConversationId || ""),
      filename: String(draft.filename),
      content: String(draft.content),
      location: String(draft.location || "."),
      status: (String(draft.status || "active") as DocumentDraft["status"]),
      createdAt: typeof draft.created_at === "number" ? draft.created_at : undefined,
      updatedAt: typeof draft.updated_at === "number" ? draft.updated_at : undefined,
    };
  } catch {
    return null;
  }
}

const DEFAULT_GREETING: Message = {
  id: "greeting",
  role: "assistant",
  content: "Hello! How can I help you today?",
  timestamp: new Date().toLocaleTimeString(),
};

export default function ChatPanel({
  conversationId,
  onConversationCreated,
}: ChatPanelProps): ReactNode {
  const { currentWorkspace } = useWorkspaceStore();
  const [messages, setMessages] = useState<Message[]>([DEFAULT_GREETING]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [pinnedDocs, setPinnedDocs] = useState<PinnedDoc[]>([]); // Persistent - used for all messages
  const [mentionedDocs, setMentionedDocs] = useState<MentionedDoc[]>([]); // Temporary - only for current message
  const [workspaceDocs, setWorkspaceDocs] = useState<WorkspaceDoc[]>([]);
  const [quickPinDocs, setQuickPinDocs] = useState<WorkspaceDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);

  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [isPinDropdownOpen, setIsPinDropdownOpen] = useState(false);
  
  const { textSelections, removeSelection, clearSelections } = useDocumentStore();

  // Streaming state
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingSteps, setStreamingSteps] = useState<Step[]>([]);
  const streamingStepsRef = useRef<Step[]>([]);
  const isSending = useRef(false);

  // Edit/Retry state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Document draft state
  const [activeDraft, setActiveDraft] = useState<DocumentDraft | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState("");
  const [saveLocation, setSaveLocation] = useState("");
  const [saveFormat, setSaveFormat] = useState<SaveFormat>("docx");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const activeConversationIdRef = useRef<string | null>(conversationId);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const updateScrollToBottomVisibility = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) {
      setShowScrollToBottom(false);
      return;
    }

    const hasOverflow = container.scrollHeight - container.clientHeight > 20;
    const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
    setShowScrollToBottom(hasOverflow && !isAtBottom);
  }, []);

  useEffect(() => {
    if (isLoading || streamingContent) {
      scrollToBottom();
    }
  }, [streamingContent, isLoading, messages, scrollToBottom]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;

    const handleScroll = () => updateScrollToBottomVisibility();
    container.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    const timer = window.setTimeout(handleScroll, 0);
    return () => {
      window.clearTimeout(timer);
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [conversationId, updateScrollToBottomVisibility]);

  useEffect(() => {
    updateScrollToBottomVisibility();
  }, [messages, isLoadingConversation, isLoading, streamingContent, updateScrollToBottomVisibility]);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (!draftNotice) return;
    const timeout = window.setTimeout(() => setDraftNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [draftNotice]);

  // Listen for add-selection-to-chat events from document viewer
  useEffect(() => {
    const handleAddSelectionToChat = (event: Event) => {
      const customEvent = event as CustomEvent<{ 
        text: string; 
        filename: string; 
        path: string;
        lines?: [number, number];
        page?: number;
      }>;
      const { text, filename, path, lines, page } = customEvent.detail;
      
      // Add selection to document store (will be displayed as a pill)
      const { addSelection } = useDocumentStore.getState();
      addSelection({
        path,
        filename,
        text,
        lines,
        page
      });
    };

    window.addEventListener('add-selection-to-chat', handleAddSelectionToChat);
    return () => window.removeEventListener('add-selection-to-chat', handleAddSelectionToChat);
  }, []);

  // Listen for pin-document events from document viewer
  useEffect(() => {
    const handlePinDocument = (event: Event) => {
      const customEvent = event as CustomEvent<{ path: string; name: string }>;
      const { path, name } = customEvent.detail;
      
      // Pin the document (persistent)
      setPinnedDocs(prev => {
        if (prev.some(d => d.path === path)) return prev; // Already pinned
        return [...prev, { path, name }];
      });
    };

    window.addEventListener('pin-document', handlePinDocument);
    return () => window.removeEventListener('pin-document', handlePinDocument);
  }, []);

  // Close pin dropdown when clicking outside
  useEffect(() => {
    if (!isPinDropdownOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.pin-dropdown-container')) {
        setIsPinDropdownOpen(false);
      }
    };
    
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [isPinDropdownOpen]);

  // Listen for streaming events from sidecar
  useEffect(() => {
    if (!isTauri) return;
    
    let unlisten: (() => void) | undefined;
    
    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{
        method: string;
        params: {
          id: string;
          part: {
            type: string;
            content?: string;
            toolName?: string;
            args?: Record<string, unknown>;
            result?: unknown;
          };
        };
      }>("sidecar-notification", (event) => {
        const data = event.payload;
        
        if (data.method !== 'chat.stream') return;
        
        const part = data.params?.part;
        if (!part) return;
        
        switch (part.type) {
          case 'text':
            if (part.content) {
              setStreamingContent(part.content);
            }
            break;
            
          case 'tool-call':
            if (part.toolName) {
              const description = formatToolDescription(part.toolName, part.args || {});
              setStreamingSteps(prev => {
                const exists = prev.some(s => s.description === description && s.status === 'running');
                if (exists) return prev;
                const newSteps = [...prev, {
                  id: `${Date.now()}-${part.toolName}`,
                  description,
                  status: 'running' as const,
                  startTime: Date.now(),
                }];
                streamingStepsRef.current = newSteps;
                return newSteps;
              });
            }
            break;
            
          case 'tool-result':
            if (part.toolName) {
              if (part.toolName === 'create_document') {
                const draft = parseDraftFromToolResult(
                  part.result,
                  activeConversationIdRef.current || conversationId
                );
                if (draft) {
                  setActiveDraft(draft);
                  setDraftNotice(draft.status === "active" ? "Draft ready for review." : null);
                  setSaveError(null);
                } else if (typeof part.result === "string") {
                  try {
                    const parsed = JSON.parse(part.result) as { status?: string; message?: string };
                    if (parsed.status === "blocked") {
                      setDraftNotice(parsed.message || "An active draft already exists. Approve or discard it first.");
                    }
                  } catch {
                    // Ignore non-JSON tool responses.
                  }
                }
              }

              setStreamingSteps(prev => {
                const runningIdx = [...prev].reverse().findIndex(s => s.status === 'running');
                if (runningIdx === -1) return prev;
                
                const actualIdx = prev.length - 1 - runningIdx;
                const updated = [...prev];
                updated[actualIdx] = {
                  ...updated[actualIdx],
                  status: 'completed',
                  endTime: Date.now(),
                };
                streamingStepsRef.current = updated;
                return updated;
              });
            }
            break;
        }
      });
    };
    
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!currentWorkspace || !isTauri) return;

    if (!conversationId) {
      setMessages([DEFAULT_GREETING]);
      setMentionedDocs([]); // Clear mentions, but keep pinned docs
      setInput("");
      setActiveDraft(null);
      setDraftNotice(null);
      setIsSaveDialogOpen(false);
      return;
    }

    const loadConversation = async () => {
      try {
        setIsLoadingConversation(true);
        const { invoke } = await import("@tauri-apps/api/core");
        
        const conv = await invoke<{
          messages: Array<{
            id: string;
            role: string;
            content: string;
            timestamp?: string;
            sources?: Array<{ doc: string; page?: number }>;
            plan?: Plan;
          }>;
        }>("get_conversation", {
          workspaceId: currentWorkspace.id,
          conversationId: conversationId,
        });

        if (conv.messages && conv.messages.length > 0) {
          // Convert backend messages to frontend Message format
          const loadedMessages: Message[] = conv.messages
            .filter((msg) => msg.role === "user" || msg.role === "assistant")
            .map((msg) => ({
              id: msg.id,
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: msg.timestamp || new Date().toLocaleTimeString(),
              sources: msg.sources,
              plan: msg.plan,
            }));
          setMessages(loadedMessages);
        } else {
          // No messages yet, show greeting
          setMessages([DEFAULT_GREETING]);
        }
      } catch (error) {
        console.error("Failed to load conversation:", error);
        setMessages([DEFAULT_GREETING]);
      } finally {
        setIsLoadingConversation(false);
      }
    };

    loadConversation();
  }, [conversationId, currentWorkspace?.id]);

  useEffect(() => {
    if (!currentWorkspace || !isTauri || !conversationId) {
      setActiveDraft(null);
      return;
    }

    const loadActiveDraft = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const draft = await invoke<{
          id: string;
          conversation_id: string;
          filename: string;
          content: string;
          location: string;
          status: "active" | "discarded" | "saved";
          created_at?: number;
          updated_at?: number;
        } | null>("get_active_document_draft", {
          workspaceId: currentWorkspace.id,
          conversationId,
        });

        if (!draft) {
          setActiveDraft(null);
          return;
        }

        setActiveDraft({
          id: draft.id,
          conversationId: draft.conversation_id,
          filename: draft.filename,
          content: draft.content,
          location: draft.location || ".",
          status: draft.status || "active",
          createdAt: draft.created_at,
          updatedAt: draft.updated_at,
        });
      } catch (error) {
        console.error("Failed to load active draft:", error);
      }
    };

    void loadActiveDraft();
  }, [conversationId, currentWorkspace?.id]);

  const loadWorkspaceDocs = useCallback(async () => {
    if (!currentWorkspace || !isTauri) return;

    try {
      setIsLoadingDocs(true);
      const { invoke } = await import("@tauri-apps/api/core");
      const docs = await invoke<Array<{
        path: string;
        name: string;
        modified_at?: number | null;
        created_at?: number | null;
      }>>("list_workspace_documents", {
        workspaceId: currentWorkspace.id,
      });

      const normalizedDocs: WorkspaceDoc[] = (docs || []).map((doc) => ({
        path: doc.path,
        name: doc.name,
        modifiedAt: toEpochMs(doc.modified_at) ?? undefined,
        createdAt: toEpochMs(doc.created_at) ?? undefined,
      }));

      const validPaths = new Set(normalizedDocs.map((doc) => doc.path));
      setWorkspaceDocs(normalizedDocs);
      setPinnedDocs((prev) => prev.filter((doc) => validPaths.has(doc.path)));
      setMentionedDocs((prev) => prev.filter((doc) => validPaths.has(doc.path)));
    } catch (err) {
      console.error("Failed to load workspace docs:", err);
    } finally {
      setIsLoadingDocs(false);
    }
  }, [currentWorkspace?.id]);

  useEffect(() => {
    if (!currentWorkspace) {
      setWorkspaceDocs([]);
      return;
    }

    void loadWorkspaceDocs();
    // Mentions are message-scoped and should reset on workspace switch.
    setMentionedDocs([]);
  }, [currentWorkspace?.id, loadWorkspaceDocs]);

  useEffect(() => {
    if (conversationId) {
      setQuickPinDocs([]);
      return;
    }
    setQuickPinDocs(pickRecentDocuments(workspaceDocs, 4));
  }, [conversationId, workspaceDocs, currentWorkspace?.id]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input, conversationId]);

  async function handleSend(
    messageContent?: string,
    contextToUse?: { pinnedDocs: PinnedDoc[]; mentionedDocs: MentionedDoc[]; textSelections: typeof textSelections },
    skipUserMessage: boolean = false,
    isEdit: boolean = false
  ): Promise<void> {
    // Ensure contentToSend is always a string to prevent "trim is not a function" errors
    const contentToSend = String(messageContent || input || '');
    if (!contentToSend.trim() || isLoading || isSending.current) return;
    
    if (!currentWorkspace) {
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: "Please open a workspace first before sending messages.",
        timestamp: new Date().toLocaleTimeString(),
      }]);
      return;
    }

    isSending.current = true;
    
    // Use provided context or current context
    const context = contextToUse || {
      pinnedDocs,
      mentionedDocs,
      textSelections: Array.from(textSelections),
    };

    // Only add user message if not skipping (e.g., during retry, message already exists)
    if (!skipUserMessage) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: contentToSend,
        timestamp: new Date().toLocaleTimeString(),
        // Store context for retry functionality
        pinnedDocs: context.pinnedDocs,
        mentionedDocs: context.mentionedDocs,
        textSelections: context.textSelections,
      };

      // Prevent duplicate user messages - check if last message is already a user message with same content
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'user' && lastMsg.content === contentToSend) {
          // Already exists, don't add duplicate
          return prev;
        }
        return [...prev, userMessage];
      });
    }
    const currentInput = contentToSend;
    if (!messageContent) {
      setInput("");
    }
    setIsLoading(true);
    
    // Reset streaming state
    setStreamingContent("");
    setStreamingSteps([]);
    streamingStepsRef.current = [];

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const conv = await invoke<{ id: string }>("create_conversation", {
          workspaceId: currentWorkspace.id,
          title: currentInput.slice(0, 50),
        });
        activeConversationId = conv.id;
        onConversationCreated(activeConversationId);
      }
      activeConversationIdRef.current = activeConversationId;

      // Combine pinned (persistent) and mentioned (temporary) docs
      const allDocPaths = [
        ...context.pinnedDocs.map((doc) => doc.path),
        ...context.mentionedDocs.map((doc) => doc.path)
      ];
      
      // Format selections for the message
      let finalMessage = currentInput;
      if (context.textSelections.length > 0) {
        const selectionsText = context.textSelections.map(s => {
          const sourceLabel = s.lines 
            ? `(lines ${s.lines[0]}-${s.lines[1]})` 
            : s.page 
            ? `(page ${s.page})` 
            : "(selection)";
          return `[Reference: ${s.filename} ${sourceLabel}]\n${s.text}\n[End Reference]`;
        }).join("\n\n");
        
        finalMessage = `${finalMessage}\n\nFocused Context:\n${selectionsText}`;
      }

      const result = await invoke<{
        response: string;
        sources: Array<{ doc: string; page?: number }>;
        plan?: Plan;
      }>("chat", {
        workspaceId: currentWorkspace.id,
        message: finalMessage,
        pinnedDocs: allDocPaths,
        conversationId: activeConversationId,
        isRetry: skipUserMessage, // Pass isRetry flag when skipping user message
        isEdit,
      });

      // Finalize steps
      const finalSteps = streamingStepsRef.current.map(s => ({
        ...s,
        status: 'completed' as const,
        endTime: s.endTime || Date.now(),
      }));

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response,
        timestamp: new Date().toLocaleTimeString(),
        sources: result.sources,
        plan: result.plan,
        steps: finalSteps.length > 0 ? finalSteps : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      
      // Clear streaming state, mentioned docs, and selections (but keep pinned docs)
      setStreamingContent("");
      setStreamingSteps([]);
      streamingStepsRef.current = [];
      if (!contextToUse) {
        setMentionedDocs([]); // Clear mentions after sending, but keep pinned
        clearSelections(); // Clear text selections after sending
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorSteps = streamingStepsRef.current;
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: `Error: ${error}`,
        timestamp: new Date().toLocaleTimeString(),
        steps: errorSteps.length > 0 ? errorSteps : undefined,
      }]);
      
      setStreamingContent("");
      setStreamingSteps([]);
      streamingStepsRef.current = [];
      if (!contextToUse) {
        setMentionedDocs([]); // Clear mentions on error too
        clearSelections(); // Clear selections on error too
      }
    } finally {
      setIsLoading(false);
      isSending.current = false;
    }
  }

  async function handleEditSave(): Promise<void> {
    if (!editingMessageId || !editingContent.trim()) return;

    const messageIndex = messages.findIndex(m => m.id === editingMessageId);
    if (messageIndex === -1) return;

    const message = messages[messageIndex];
    if (message.role !== 'user') return;

    // Remove the edited message and any subsequent messages
    setMessages((prev) => {
      const index = prev.findIndex(m => m.id === editingMessageId);
      if (index === -1) return prev;
      return prev.slice(0, index);
    });

    // Clear editing state
    setEditingMessageId(null);
    setEditingContent("");

    // Send the edited message
    await handleSend(
      editingContent,
      {
        pinnedDocs: message.pinnedDocs || [],
        mentionedDocs: message.mentionedDocs || [],
        textSelections: message.textSelections || [],
      },
      false, // skipUserMessage
      true   // isEdit
    );
  }

  function handleEditCancel(): void {
    setEditingMessageId(null);
    setEditingContent("");
  }

  async function handleCopy(messageId: string, content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }

  async function handleRetry(messageId: string): Promise<void> {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const assistantMessage = messages[messageIndex];
    if (assistantMessage.role !== 'assistant') return;

    // Find the previous user message
    let userMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }

    if (userMessageIndex === -1) return;

    const userMessage = messages[userMessageIndex];
    setIsRetrying(true);

    // Remove the assistant message
    setMessages((prev) => prev.filter(m => m.id !== messageId));

    // Extract original user message content (strip pinned docs section if present)
    // The backend appends pinned docs to content, so we need to extract just the original text
    let originalContent = userMessage.content;
    const pinnedDocsMarker = '\n\n---\n**Pinned Documents**';
    if (originalContent.includes(pinnedDocsMarker)) {
      originalContent = originalContent.split(pinnedDocsMarker)[0].trim();
    }

    // Ensure user message isn't duplicated - remove any duplicate user messages with same content
    setMessages((prev) => {
      const userMsgId = messages[userMessageIndex].id;
      // Keep only the first occurrence of the user message
      const seen = new Set<string>();
      return prev.filter((msg) => {
        if (msg.id === userMsgId) {
          if (seen.has(userMsgId)) {
            return false; // Remove duplicate
          }
          seen.add(userMsgId);
          return true;
        }
        return true;
      });
    });

    // Resend the user message with its stored context
    // Skip adding user message since it already exists in the array
    await handleSend(originalContent, {
      pinnedDocs: userMessage.pinnedDocs || [],
      mentionedDocs: userMessage.mentionedDocs || [],
      textSelections: userMessage.textSelections || [],
    }, true); // skipUserMessage = true

    setIsRetrying(false);
  }

  function handleInputChange(value: string): void {
    setInput(value);
    const lastAt = value.lastIndexOf("@");
    if (lastAt === -1 || value.slice(lastAt + 1).includes(" ")) {
      setIsMentionOpen(false);
      return;
    }
    if (!isMentionOpen) {
      void loadWorkspaceDocs();
    }
    setIsMentionOpen(true);
    setMentionQuery(value.slice(lastAt + 1));
    setMentionStart(lastAt);
  }

  function pinDocument(doc: { path: string; name: string }): void {
    setPinnedDocs((prev) => {
      if (prev.some((d) => d.path === doc.path)) return prev;
      return [...prev, { path: doc.path, name: doc.name }];
    });
  }

  function applyStarterPrompt(prompt: string): void {
    handleInputChange(prompt);
    requestAnimationFrame(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursorPos = prompt.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function openSaveDialog(): void {
    if (!activeDraft) return;

    const savedFormat = (() => {
      if (typeof window === "undefined") return null;
      const stored = window.localStorage.getItem(LAST_FORMAT_STORAGE_KEY);
      return stored === "md" || stored === "docx" || stored === "txt" ? (stored as SaveFormat) : null;
    })();

    setSaveFilename(activeDraft.filename);
    setSaveLocation(activeDraft.location && activeDraft.location !== "." ? activeDraft.location : ".");
    setSaveFormat(savedFormat || "docx");
    setSaveError(null);
    setIsSaveDialogOpen(true);
  }

  async function handleBrowseSaveLocation(): Promise<void> {
    if (!isTauri || !currentWorkspace) return;

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected || typeof selected !== "string") return;
      const relativePath = toWorkspaceRelativePath(selected, currentWorkspace.path);
      if (!relativePath) {
        setSaveError("Selected folder must be inside the active workspace.");
        return;
      }

      setSaveLocation(relativePath);
      setSaveError(null);
    } catch (error) {
      console.error("Failed to browse save location:", error);
      setSaveError("Failed to open folder picker.");
    }
  }

  async function handleDiscardDraft(): Promise<void> {
    if (!activeDraft || !currentWorkspace || !isTauri) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("discard_document_draft", {
        workspaceId: currentWorkspace.id,
        conversationId: activeDraft.conversationId,
        draftId: activeDraft.id,
      });
    } catch (error) {
      console.error("Failed to discard draft:", error);
    } finally {
      setActiveDraft(null);
      setIsSaveDialogOpen(false);
      setSaveError(null);
      setDraftNotice("Draft discarded.");
    }
  }

  async function handleConfirmSaveDraft(): Promise<void> {
    if (!activeDraft || !currentWorkspace || !isTauri || isSavingDraft) return;

    const filename = saveFilename.trim();
    if (!filename) {
      setSaveError("Filename is required.");
      return;
    }

    const location = saveLocation.trim() || ".";
    setIsSavingDraft(true);
    setSaveError(null);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<SaveDocumentResult>("save_document", {
        workspaceId: currentWorkspace.id,
        conversationId: activeDraft.conversationId,
        draftId: activeDraft.id,
        filename,
        content: activeDraft.content,
        location,
        format: saveFormat,
      });

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_FORMAT_STORAGE_KEY, result.format);
      }

      setActiveDraft(null);
      setIsSaveDialogOpen(false);
      setSaveError(null);
      setDraftNotice(result.message || "Document saved.");
      void loadWorkspaceDocs();
    } catch (error) {
      console.error("Failed to save draft:", error);
      setSaveError(`Failed to save document: ${String(error)}`);
    } finally {
      setIsSavingDraft(false);
    }
  }

  useEffect(() => {
    if (!activeDraft || isSaveDialogOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
      event.preventDefault();
      openSaveDialog();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDraft, isSaveDialogOpen]);

  const filteredMentionDocs = isMentionOpen
    ? workspaceDocs.filter((doc) => {
        // Don't show if already pinned or mentioned
        if (pinnedDocs.some((p) => p.path === doc.path) || mentionedDocs.some((m) => m.path === doc.path)) return false;
        if (!mentionQuery) return true;
        return doc.name.toLowerCase().includes(mentionQuery.toLowerCase());
      })
    : [];

  const markdownComponents: any = {
    p: ({ children }: { children: ReactNode }) => <p className="mb-3 last:mb-0 text-[15px] leading-[1.75] font-medium">{children}</p>,
    ul: ({ children }: { children: ReactNode }) => <ul className="mb-3 pl-4 space-y-1 list-disc">{children}</ul>,
    ol: ({ children }: { children: ReactNode }) => <ol className="mb-3 pl-4 space-y-1 list-decimal">{children}</ol>,
    li: ({ children }: { children: ReactNode }) => <li className="leading-[1.7]">{children}</li>,
    h1: ({ children }: { children: ReactNode }) => <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0 font-sans">{children}</h1>,
    h2: ({ children }: { children: ReactNode }) => <h2 className="text-lg font-bold mb-2 mt-4 first:mt-0 font-sans">{children}</h2>,
    h3: ({ children }: { children: ReactNode }) => <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 font-sans">{children}</h3>,
    strong: ({ children }: { children: ReactNode }) => <strong className="font-bold">{children}</strong>,
    code: ({ className, children }: { className?: string; children: ReactNode }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return <code className="block p-3 bg-muted rounded-lg overflow-x-auto text-sm font-mono my-2">{children}</code>;
      }
      return <code className="px-1 py-0.5 bg-muted rounded text-sm font-mono">{children}</code>;
    },
    pre: ({ children }: { children: ReactNode }) => <pre className="my-3">{children}</pre>,
    blockquote: ({ children }: { children: ReactNode }) => (
      <blockquote className="border-l-2 border-border pl-4 my-3 italic text-muted-foreground">{children}</blockquote>
    ),
    a: ({ href, children }: { href?: string; children: ReactNode }) => (
      <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
    ),
    table: ({ children }: { children: ReactNode }) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border border-border text-sm">{children}</table>
      </div>
    ),
    th: ({ children }: { children: ReactNode }) => <th className="px-3 py-2 border border-border bg-muted font-semibold text-left">{children}</th>,
    td: ({ children }: { children: ReactNode }) => <td className="px-3 py-2 border border-border">{children}</td>,
  };

  const isFreshNewConversation =
    !conversationId &&
    messages.length === 1 &&
    messages[0]?.id === DEFAULT_GREETING.id;

  if (isFreshNewConversation) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="min-h-full flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-3xl mt-12">
              <motion.h1
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="text-center text-4xl font-semibold tracking-tight"
              >
                What do you want to know?
              </motion.h1>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.08 }}
                className="mt-8 relative z-30"
              >
                {(pinnedDocs.length > 0 || mentionedDocs.length > 0 || textSelections.length > 0) && (
                  <div className="mb-3 space-y-2">
                    {textSelections.length > 0 && (
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Selected Context
                        </span>
                        {textSelections.map((sel) => (
                          <div key={sel.id} className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 border border-primary/30 rounded-md text-xs">
                            <span className="truncate max-w-[220px]">
                              {sel.filename} {sel.lines ? `(lines ${sel.lines[0]}-${sel.lines[1]})` : sel.page ? `(p${sel.page})` : ""}
                            </span>
                            <button
                              onClick={() => removeSelection(sel.id)}
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="Remove selection"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {pinnedDocs.length > 0 && (
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {pinnedDocs.map((doc) => (
                          <div key={doc.path} className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border border-border/50 rounded-md text-xs">
                            <span className="truncate max-w-[220px]">{doc.name}</span>
                            <button
                              onClick={() => setPinnedDocs((p) => p.filter((d) => d.path !== doc.path))}
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="Unpin"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {mentionedDocs.length > 0 && (
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          @ Mentioned
                        </span>
                        {mentionedDocs.map((doc) => (
                          <div key={doc.path} className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs">
                            <span className="truncate max-w-[220px]">{doc.name}</span>
                            <button
                              onClick={() => setMentionedDocs((m) => m.filter((d) => d.path !== doc.path))}
                              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                              title="Remove mention"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="relative z-30">
                  <div className="flex items-end gap-2 bg-muted/30 border border-border rounded-2xl focus-within:border-primary/50 transition-colors">
                    <div className="relative pin-dropdown-container">
                      <button
                        className="flex-shrink-0 p-3 text-muted-foreground hover:text-foreground transition-colors"
                        title="Pin document"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextOpen = !isPinDropdownOpen;
                          setIsPinDropdownOpen(nextOpen);
                          if (nextOpen) {
                            void loadWorkspaceDocs();
                          }
                        }}
                      >
                        <Plus size={20} />
                      </button>

                      {isPinDropdownOpen && workspaceDocs.length > 0 && (
                        <div
                          className="absolute bottom-full mb-2 left-0 w-64 bg-popover border border-border shadow-lg rounded-lg overflow-hidden z-[80] max-h-64"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="p-2 border-b border-border bg-primary/5">
                            <div className="flex items-center gap-2">
                              <Paperclip size={12} className="text-primary" />
                              <span className="text-xs font-semibold text-foreground">Pin Document</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Pin for all messages</p>
                          </div>
                          <div className="max-h-56 overflow-y-auto custom-scrollbar">
                            {workspaceDocs
                              .filter((doc) => !pinnedDocs.some((p) => p.path === doc.path))
                              .map((doc) => (
                                <button
                                  key={doc.path}
                                  className="w-full text-left px-3 py-2 hover:bg-muted flex flex-col gap-0.5 transition-colors border-b border-border/30 last:border-0"
                                  onClick={() => {
                                    pinDocument(doc);
                                    setIsPinDropdownOpen(false);
                                  }}
                                >
                                  <span className="text-sm font-medium">{doc.name}</span>
                                  <span className="text-xs text-muted-foreground truncate">{doc.path}</span>
                                </button>
                              ))}
                            {workspaceDocs.filter((doc) => !pinnedDocs.some((p) => p.path === doc.path)).length === 0 && (
                              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                All documents are pinned
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={input}
                      onChange={(e) => {
                        handleInputChange(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                          e.currentTarget.style.height = "auto";
                        }
                      }}
                      placeholder="Ask anything about your documents..."
                      disabled={editingMessageId !== null || isRetrying}
                      className="flex-1 bg-transparent py-3 focus:outline-none resize-none text-[14px] leading-relaxed min-h-[44px] max-h-[200px] disabled:opacity-50 disabled:cursor-not-allowed custom-scrollbar"
                    />

                    <button
                      onClick={() => handleSend()}
                      disabled={!input.trim() || isLoading || editingMessageId !== null || isRetrying}
                      className="flex-shrink-0 m-2 p-2 bg-foreground text-background rounded-full hover:opacity-80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ArrowUp size={16} />
                    </button>
                  </div>

                  {isMentionOpen && filteredMentionDocs.length > 0 && (
                    <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border border-border shadow-lg rounded-lg overflow-hidden z-[80]">
                      <div className="max-h-64 overflow-y-auto">
                        {filteredMentionDocs.map((doc) => (
                          <div key={doc.path} className="flex items-center group border-b border-border/30 last:border-0">
                            <button
                              className="flex-1 text-left px-4 py-2.5 hover:bg-muted flex flex-col gap-0.5 transition-colors"
                              onClick={() => {
                                const before = input.slice(0, mentionStart!);
                                const after = input.slice(input.lastIndexOf("@") + 1 + mentionQuery.length);
                                setInput(`${before}@${doc.name} ${after}`);
                                setMentionedDocs((m) => (m.some((d) => d.path === doc.path) ? m : [...m, doc]));
                                setIsMentionOpen(false);
                              }}
                            >
                              <span className="text-sm font-medium">{doc.name}</span>
                              <span className="text-xs text-muted-foreground truncate">{doc.path}</span>
                            </button>
                            <div className="flex items-center gap-1 pr-2">
                              <button
                                className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  pinDocument(doc);
                                  setIsMentionOpen(false);
                                }}
                                title="Pin document (use for all messages)"
                              >
                                <Paperclip size={12} />
                                <span className="text-[10px]">Pin</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

              <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
                {[ 
                  { label: "Find information", icon: Search, value: "Help me find information about " },
                  { label: "Compare documents", icon: BookOpen, value: "Compare and contrast " },
                  { label: "Create document", icon: FileText, value: "Create a document based on my workspace about " },
                ].map((chip, index) => {
                  const ChipIcon = chip.icon;
                  return (
                    <motion.button
                      key={chip.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: 0.18 + index * 0.07 }}
                      onClick={() => applyStarterPrompt(chip.value)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-accent border border-border/50 rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChipIcon size={14} />
                      <span>{chip.label}</span>
                    </motion.button>
                  );
                })}
              </div>

              {quickPinDocs.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 }}
                  className="mt-8"
                >
                  <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Pin a document to start
                  </p>
                  <div className="mt-3 space-y-2">
                    {quickPinDocs.map((doc, index) => {
                      const { Icon, colorClass } = getDocumentTypeMeta(doc.name);
                      const isPinned = pinnedDocs.some((p) => p.path === doc.path);

                      return (
                        <motion.button
                          key={doc.path}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25, delay: 0.36 + index * 0.05 }}
                          onClick={() => pinDocument(doc)}
                          className="group w-full flex items-center justify-between px-3 py-2 border border-border/50 rounded-xl bg-secondary/40 hover:bg-accent/60 transition-colors"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`w-8 h-8 rounded-lg border border-border/50 bg-background flex items-center justify-center ${colorClass}`}>
                              <Icon size={16} />
                            </span>
                            <span className="text-sm font-medium truncate">{doc.name}</span>
                          </span>
                          <Paperclip
                            size={14}
                            className={isPinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"}
                          />
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages Area - Centered */}
      <div className="relative flex-1 min-h-0">
        <div ref={messagesScrollRef} className="h-full overflow-y-auto custom-scrollbar">
          <div className="max-w-4xl mx-auto px-4 py-6">
            {/* Messages */}
            <div className="space-y-6">
              {draftNotice && (
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                  {draftNotice}
                </div>
              )}

              {isLoadingConversation ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" />
                  </div>
                </div>
              ) : (
                (() => {
                // Find the most recent user message index
                let mostRecentUserIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === 'user') {
                    mostRecentUserIndex = i;
                    break;
                  }
                }
                
                // Find the most recent assistant message index (excluding greeting)
                let mostRecentAssistantIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === 'assistant' && messages[i].id !== 'greeting') {
                    mostRecentAssistantIndex = i;
                    break;
                  }
                }
                
                return messages.map((message, index) => {
                  const isMostRecentUser = message.role === 'user' && index === mostRecentUserIndex;
                  const isMostRecentAssistant = message.role === 'assistant' && message.id !== 'greeting' && index === mostRecentAssistantIndex;
                  const isEditing = editingMessageId === message.id;

                return (
              <div key={message.id} className="group">
                {message.role === 'user' ? (
                  // User message - right aligned bubble
                  <div className="flex flex-col items-end gap-2 w-full">
                    <div className={`${isEditing ? 'w-full max-w-3xl' : 'max-w-[85%]'} bg-muted rounded-2xl rounded-tr-sm px-4 py-3`}>
                      {isEditing ? (
                        // Inline editor
                        <div className="space-y-2">
                          <textarea
                            value={editingContent}
                            onChange={(e) => {
                              setEditingContent(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                            }}
                            onKeyDown={(e) => {
                              // Allow Enter for new lines, use Save button to save
                            }}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[15px] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px] max-h-[200px] custom-scrollbar"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={handleEditCancel}
                              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleEditSave}
                              disabled={!editingContent.trim() || isLoading}
                              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap font-medium">{message.content}</p>
                      )}
                    </div>
                    {/* Action buttons row - below message */}
                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        {/* Copy button - always visible */}
                        <button
                          onClick={() => handleCopy(message.id, message.content)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          title="Copy message"
                        >
                          <Copy size={14} className={copiedMessageId === message.id ? "text-green-500" : ""} />
                        </button>
                        {/* Edit button - only for most recent user message */}
                        {isMostRecentUser && (
                          <button
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditingContent(message.content);
                            }}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit message"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  // Assistant message - left aligned, full width
                  <div className="space-y-3">
                    {message.steps && message.steps.length > 0 && (
                      <StepsDropdown steps={message.steps} isStreaming={false} />
                    )}
                    {message.plan && (
                      <div className="bg-muted/50 border border-border rounded-lg p-4">
                        <PlanView plan={message.plan} />
                      </div>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed font-sans">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    {message.sources && message.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {message.sources.map((source, idx) => (
                          <span key={idx} className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            📄 {source.doc}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Action buttons row - below message */}
                    <div className="flex items-center gap-1 mt-2">
                      {/* Copy button - always visible */}
                      <button
                        onClick={() => handleCopy(message.id, message.content)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                        title="Copy message"
                      >
                        <Copy size={14} className={copiedMessageId === message.id ? "text-green-500" : ""} />
                      </button>
                      {/* Retry button - only for most recent assistant message */}
                      {isMostRecentAssistant && (
                        <button
                          onClick={() => handleRetry(message.id)}
                          disabled={isRetrying || isLoading}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Retry"
                        >
                          <RefreshCw size={14} className={isRetrying ? 'animate-spin' : ''} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
            });
            })()
                )}
              
              {activeDraft && (
                <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Document Draft
                      </p>
                      <p className="text-sm font-semibold text-foreground">{activeDraft.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        Location: {activeDraft.location && activeDraft.location !== "." ? activeDraft.location : "workspace root"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openSaveDialog()}
                        className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void handleDiscardDraft()}
                        className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  </div>

                  <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed font-sans max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {activeDraft.content}
                    </ReactMarkdown>
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Press <span className="font-semibold">Ctrl+Enter</span> (or <span className="font-semibold">Cmd+Enter</span>) to approve quickly.
                  </p>
                </div>
              )}

              {/* Streaming message */}
              {isLoading && (
                <div className="space-y-3">
                  {streamingSteps.length > 0 && (
                    <StepsDropdown steps={streamingSteps} isStreaming={true} />
                  )}
                  
                  {streamingContent ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed font-sans">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" />
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {showScrollToBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute left-1/2 -translate-x-1/2 bottom-5 w-9 h-9 rounded-full border border-border bg-secondary/95 hover:bg-accent text-foreground shadow-lg transition-colors z-20 flex items-center justify-center"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* Input Area - Centered, same width as messages */}
      <div className="bg-background">
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* Pinned, Mentioned Docs, and Selections - Above Input */}
          {(pinnedDocs.length > 0 || mentionedDocs.length > 0 || textSelections.length > 0) && (
            <div className="mb-3 space-y-2">
              {/* Text Selections (from "Add to Chat") */}
              {textSelections.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Selected Context
                  </span>
                  {textSelections.map((sel) => (
                    <div key={sel.id} className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 border border-primary/30 rounded-md text-xs">
                      <span className="truncate max-w-[150px]">
                        {sel.filename} {sel.lines ? `(lines ${sel.lines[0]}-${sel.lines[1]})` : sel.page ? `(p${sel.page})` : ""}
                      </span>
                      <button 
                        onClick={() => removeSelection(sel.id)} 
                        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        title="Remove selection"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Pinned Docs (Persistent) */}
              {pinnedDocs.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Paperclip size={10} />
                    Pinned
                  </span>
                  {pinnedDocs.map((doc) => (
                    <div key={doc.path} className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border border-border/50 rounded-md text-xs">
                      <span className="truncate max-w-[120px]">{doc.name}</span>
                      <button 
                        onClick={() => setPinnedDocs(p => p.filter(d => d.path !== doc.path))} 
                        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        title="Unpin"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Mentioned Docs (Temporary - only for this message) */}
              {mentionedDocs.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    @ Mentioned
                  </span>
                  {mentionedDocs.map((doc) => (
                    <div key={doc.path} className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs">
                      <span className="truncate max-w-[120px]">{doc.name}</span>
                      <button 
                        onClick={() => setMentionedDocs(m => m.filter(d => d.path !== doc.path))} 
                        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        title="Remove mention"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          <div className="relative z-20">
            {/* Input box */}
            <div className="flex items-end gap-2 bg-muted/30 border border-border rounded-2xl focus-within:border-primary/50 transition-colors">
              <div className="relative pin-dropdown-container">
                <button
                  className="flex-shrink-0 p-3 text-muted-foreground hover:text-foreground transition-colors"
                  title="Pin document"
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextOpen = !isPinDropdownOpen;
                    setIsPinDropdownOpen(nextOpen);
                    if (nextOpen) {
                      void loadWorkspaceDocs();
                    }
                  }}
                >
                  <Plus size={20} />
                </button>
                
                {/* Pin Document Dropdown */}
                {isPinDropdownOpen && workspaceDocs.length > 0 && (
                  <div 
                    className="absolute bottom-full mb-2 left-0 w-64 bg-popover border border-border shadow-lg rounded-lg overflow-hidden z-[80] max-h-64"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-2 border-b border-border bg-primary/5">
                      <div className="flex items-center gap-2">
                        <Paperclip size={12} className="text-primary" />
                        <span className="text-xs font-semibold text-foreground">Pin Document</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Pin for all messages</p>
                    </div>
                    <div className="max-h-56 overflow-y-auto custom-scrollbar">
                      {workspaceDocs
                        .filter(doc => !pinnedDocs.some(p => p.path === doc.path))
                        .map((doc) => (
                          <button
                            key={doc.path}
                            className="w-full text-left px-3 py-2 hover:bg-muted flex flex-col gap-0.5 transition-colors border-b border-border/30 last:border-0"
                            onClick={() => {
                              setPinnedDocs(prev => {
                                if (prev.some(d => d.path === doc.path)) return prev;
                                return [...prev, { path: doc.path, name: doc.name }];
                              });
                              setIsPinDropdownOpen(false);
                            }}
                          >
                            <span className="text-sm font-medium">{doc.name}</span>
                            <span className="text-xs text-muted-foreground truncate">{doc.path}</span>
                          </button>
                        ))}
                      {workspaceDocs.filter(doc => !pinnedDocs.some(p => p.path === doc.path)).length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          All documents are pinned
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <textarea
                rows={1}
                value={input}
                onChange={(e) => {
                  handleInputChange(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                    e.currentTarget.style.height = 'auto';
                  }
                }}
                placeholder="Ask anything"
                disabled={editingMessageId !== null || isRetrying}
                className="flex-1 bg-transparent py-3 focus:outline-none resize-none text-[15px] leading-relaxed min-h-[44px] max-h-[200px] disabled:opacity-50 disabled:cursor-not-allowed custom-scrollbar"
              />
              
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading || editingMessageId !== null || isRetrying}
                className="flex-shrink-0 m-2 p-2 bg-foreground text-background rounded-full hover:opacity-80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ArrowUp size={16} />
              </button>
            </div>

            {/* Mentions dropdown */}
            {isMentionOpen && filteredMentionDocs.length > 0 && (
              <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border border-border shadow-lg rounded-lg overflow-hidden z-[80]">
                <div className="max-h-64 overflow-y-auto">
                  {filteredMentionDocs.map((doc) => (
                    <div key={doc.path} className="flex items-center group border-b border-border/30 last:border-0">
                      <button
                        className="flex-1 text-left px-4 py-2.5 hover:bg-muted flex flex-col gap-0.5 transition-colors"
                        onClick={() => {
                          const before = input.slice(0, mentionStart!);
                          const after = input.slice(input.lastIndexOf("@") + 1 + mentionQuery.length);
                          setInput(`${before}@${doc.name} ${after}`);
                          // Add to mentioned docs (temporary, only for this message)
                          setMentionedDocs(m => m.some(d => d.path === doc.path) ? m : [...m, doc]);
                          setIsMentionOpen(false);
                        }}
                      >
                        <span className="text-sm font-medium">{doc.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{doc.path}</span>
                      </button>
                      <div className="flex items-center gap-1 pr-2">
                        <button
                          className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Pin the document (persistent)
                            setPinnedDocs(prev => {
                              if (prev.some(d => d.path === doc.path)) return prev;
                              return [...prev, doc];
                            });
                            setIsMentionOpen(false);
                          }}
                          title="Pin document (use for all messages)"
                        >
                          <Paperclip size={12} />
                          <span className="text-[10px]">Pin</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <p className="text-center text-xs text-muted-foreground mt-2">
            + to pin • @ to mention (this message only) • Right-click text to add context • Press Enter to send
          </p>
        </div>
      </div>

      {isSaveDialogOpen && activeDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-popover p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Save document</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Review and confirm where this draft should be saved.
                </p>
              </div>
              <button
                onClick={() => {
                  setIsSaveDialogOpen(false);
                  setSaveError(null);
                }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filename</span>
                <input
                  type="text"
                  value={saveFilename}
                  onChange={(e) => setSaveFilename(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="document-name"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</span>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={saveLocation}
                    onChange={(e) => setSaveLocation(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="."
                  />
                  <button
                    onClick={() => void handleBrowseSaveLocation()}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted transition-colors"
                    title="Browse folder"
                  >
                    <FolderOpen size={14} />
                    Browse
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Format</span>
                <select
                  value={saveFormat}
                  onChange={(e) => setSaveFormat(e.target.value as SaveFormat)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="docx">DOCX (.docx)</option>
                  <option value="md">Markdown (.md)</option>
                  <option value="txt">Text (.txt)</option>
                </select>
              </label>

              {saveError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {saveError}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setIsSaveDialogOpen(false);
                  setSaveError(null);
                }}
                className="px-3 py-2 text-xs border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmSaveDraft()}
                disabled={isSavingDraft}
                className="px-3 py-2 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSavingDraft ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
