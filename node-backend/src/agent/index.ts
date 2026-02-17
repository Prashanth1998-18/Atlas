import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, START, MessagesAnnotation, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { 
  HumanMessage, 
  SystemMessage, 
  AIMessage,
  type BaseMessage 
} from '@langchain/core/messages';
import { createTools } from './tools/index.js';
import { LanceDBStorage } from '../storage/lancedb.js';
import { v4 as uuidv4 } from 'uuid';
import { SQLiteStorage } from '../storage/sqlite.js';

// Token thresholds
const MAX_TOKENS = 100000;  // Trigger summarization when messages exceed this
const SUMMARY_TARGET_TOKENS = 10000;  // Target token count for summary

// Estimate tokens (rough approximation: 1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return total + estimateTokens(content);
  }, 0);
}

// Define our graph state with summary support
const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  summary: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
});

type GraphStateType = typeof GraphState.State;

function buildSystemPrompt(manifest: string, summary?: string): string {
  let prompt = `You are Atlas, a document Q&A agent. Your goal is to **completely resolve the user's question** using their document workspace.

You are an agent—keep going until you're confident the question is fully answered. Do not yield back to the user while uncertain. Choose the right tool for the task—if you need to explore, search; if you know what to read, read directly.

## Principles

1. **Choose the right tool for the task.** If the user asks to read specific lines or a known file, read directly. If you need to find information, search. If you need to explore the workspace, list directories. Tool selection depends on the question, not a default workflow.

2. **Explore until confident.** When searching, don't stop at the first result. Run multiple searches with different wording. Check directory listings to verify completeness. Keep going until you're sure you have the full picture.

3. **Be efficient.** Search results include full chunk text—use it before reading files. Only read files when you genuinely need more context.

4. **Use exact paths.** Always use file paths from tool responses. Never construct or guess paths.

5. **Bias toward self-sufficiency.** If you can resolve ambiguity or find missing information through tool calls, do it. Only ask the user when you genuinely cannot proceed.

6. **State what you found.** Tell the user what sources you used. If you couldn't verify completeness, say so.

## Pinned Documents

When the user pins documents, they appear at the end of their message. These are your starting point, not your boundary.

After searching pinned docs:
- If they reference other documents by name or title, search for those documents
- If the answer feels incomplete because the pinned doc assumes context from elsewhere, search the workspace for that context
- If a term, concept, or decision is mentioned but not explained, search for its source

Keep following leads until you can fully answer the question.

## Tools

| Tool | What it returns |
|------|-----------------|
| **hybrid_search** | Semantic chunks (full text) + keyword matches (line numbers) |
| **grep_search** | Exact text matches with line numbers |
| **read_file** | Entire file contents |
| **read_file_chunk** | Specific lines (use search line numbers + padding) |
| **list_directory** | Files and folders in a path |
| **get_file_info** | File metadata |
| **create_document** | Creates/updates a markdown document draft for user review |

## Document Draft Rules

- Call \`create_document\` only when the user explicitly asks to create/write/save/export a document.
- For normal Q&A, return a regular chat answer without calling \`create_document\`.
- If the user asks to refine the currently active draft, call \`create_document\` with \`replace_active=true\`.
- If the user asks to bring back a previous draft, call \`create_document\` with \`recover_latest=true\`.
- If the user asks for a different new document while a draft is active, do not create a second draft. Tell them to approve or discard the current draft first.
- Keep document content in markdown. Suggest filename without extension and optional workspace-relative location.

## Workspace

${manifest}

## Response Guidelines

**Cite sources inline.** Reference files naturally: "The contract expires in 2025 (\`contracts/vendor-a.pdf\`)." Don't dump a references list at the end.

**Match depth to the question.** Factual lookups get concise answers. Analysis or "explain" questions get structured responses. Let the question guide the format.

**Use quotes for key evidence.** When a specific phrase matters, use blockquotes:
> "The vendor shall maintain insurance coverage..."

**Be direct.** Lead with the answer. Add context after, not before.

**Admit gaps.** If you couldn't verify completeness or find something, say so clearly rather than hedging.`;

  // Add summary context if it exists
  if (summary) {
    prompt += `\n\n## Previous Conversation Context\n\nThe following is a summary of the earlier conversation:\n\n${summary}`;
  }

  return prompt;
}

export class AtlasAgent {
  private model: ChatOpenAI;
  private summarizationModel: ChatOpenAI;
  private tools: any[];
  private workspacePath: string;
  private graph: ReturnType<typeof this.buildGraph> | null = null;
  private lancedb?: LanceDBStorage;
  private sqlite: SQLiteStorage;
  private currentPinnedDocs: string[] = [];

  constructor(
    modelName: string = 'gpt-5.2',
    workspacePath: string,
    lancedb?: LanceDBStorage,
    sqlite?: SQLiteStorage
  ) {
    this.workspacePath = workspacePath;
    this.lancedb = lancedb;
    if (!sqlite) {
      throw new Error('SQLiteStorage is required for AtlasAgent');
    }
    this.sqlite = sqlite;
    
    this.model = new ChatOpenAI({
      model: modelName,
      temperature: 0.7,
    });

    // Use a faster/cheaper model for summarization
    this.summarizationModel = new ChatOpenAI({
      model: 'gpt-5-mini',
      temperature: 0.3,
    });

    // Tools will be recreated with pinned docs in run()
    this.tools = createTools(workspacePath, lancedb, [], { sqlite: this.sqlite });
  }

  private buildGraph(manifest: string) {
    const toolNode = new ToolNode(this.tools);
    const model = this.model;
    const summarizationModel = this.summarizationModel;

    // Node: Call the model
    const callModel = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
      const { messages, summary } = state;

      // Ensure a single system message is present and first; do not recreate if already stored
      const systemMessage = messages.find(m => m._getType() === 'system') as BaseMessage | undefined;
      const nonSystemMessages = messages.filter(m => m._getType() !== 'system');
      const allMessages = systemMessage ? [systemMessage, ...nonSystemMessages] : nonSystemMessages;
      
      // Bind tools to the model
      const modelWithTools = model.bindTools(this.tools);
      const response = await modelWithTools.invoke(allMessages);
      
      return { messages: [response] };
    };

    // Conditional: Should we route to tools?
    const shouldContinue = (state: GraphStateType): 'tools' | '__end__' => {
      const { messages } = state;
      const lastMessage = messages[messages.length - 1];
      
      // If the last message has tool calls, route to tools
      if (lastMessage && 'tool_calls' in lastMessage && 
          Array.isArray(lastMessage.tool_calls) && 
          lastMessage.tool_calls.length > 0) {
        return 'tools';
      }
      
      return '__end__';
    };

    // Build the graph
    const workflow = new StateGraph(GraphState)
      // Add nodes
      .addNode('check_tokens', (state: GraphStateType) => state) // Passthrough node for routing
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      
      // Entry: First check if we need to summarize
      .addEdge(START, 'agent')
      
      // After agent, check if we need to call tools
      .addConditionalEdges('agent', shouldContinue)
      
      // After tools, go back to agent
      .addEdge('tools', 'agent');

    // Compile without persistent checkpointer; history is managed in SQLiteStorage
    return workflow.compile();
  }

  async run(
    userMessage: string,
    manifest: string,
    threadId: string,
    pinnedDocs: string[] = [],
    isRetry: boolean = false,
    isEdit: boolean = false
  ): Promise<AsyncGenerator<any, void, unknown>> {
    // Update pinned docs and recreate tools with them
    this.currentPinnedDocs = pinnedDocs;
    this.tools = createTools(this.workspacePath, this.lancedb, pinnedDocs, {
      sqlite: this.sqlite,
      conversationId: threadId,
    });
    
    // Build/rebuild the graph with current manifest
    const graph = this.buildGraph(manifest);

    // Load history and summary from SQLite
    const history = this.sqlite.listMessages(threadId);
    const summaryRecord = this.sqlite.getSummary(threadId);

    const lastTurnIndex = history.length ? history[history.length - 1].turn_index : -1;
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    let baseTurnIndex = lastTurnIndex;
    let userContentForPrompt = userMessage;
    let pinnedDocsForPrompt = pinnedDocs;

    // Handle edit: remove user+assistant, re-add edited user at same turn index
    if (isEdit && lastUser) {
      const summary = this.sqlite.getSummary(threadId);
      if (summary && lastUser.turn_index <= summary.archived_upto_turn) {
        this.sqlite.clearSummary(threadId);
      }
      // Delete everything from that user turn onward
      this.sqlite.deleteMessagesAfter(threadId, lastUser.turn_index - 1);
      const pinnedSection = pinnedDocs.length
        ? `\n\n---\n**Pinned Documents** (search these first):\n${pinnedDocs.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : '';
      const userContent = `${userMessage}${pinnedSection}`;
      this.sqlite.addMessage({
        id: uuidv4(),
        conversation_id: threadId,
        role: 'user',
        content: userContent,
        turn_index: lastUser.turn_index,
        metadata: { pinned_docs: pinnedDocs },
      });
      this.sqlite.updateConversationLastMessage(threadId);
      baseTurnIndex = lastUser.turn_index;
      userContentForPrompt = userMessage;
      pinnedDocsForPrompt = pinnedDocs;
    }

    // Handle retry: remove only the last assistant turn; reuse existing user content
    if (isRetry && lastUser) {
      this.sqlite.deleteLastAssistantTurn(threadId);
      baseTurnIndex = lastUser.turn_index;
      // Use stored user content and pinned docs
      const meta = lastUser.metadata || {};
      const pinned = Array.isArray(meta.pinned_docs) ? meta.pinned_docs as string[] : [];
      pinnedDocsForPrompt = pinned;
      // Strip pinned section from stored content when building prompt
      const stored = lastUser.content as string;
      userContentForPrompt = stored.split('\n---\n')[0];
    }

    // Normal send: add new user message
    if (!isRetry && !isEdit) {
      const pinnedSection = pinnedDocs.length
        ? `\n\n---\n**Pinned Documents** (search these first):\n${pinnedDocs.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : '';
      const userContent = `${userMessage}${pinnedSection}`;
      const added = this.sqlite.addMessage({
        id: uuidv4(),
        conversation_id: threadId,
        role: 'user',
        content: userContent,
        metadata: { pinned_docs: pinnedDocs },
      });
      this.sqlite.updateConversationLastMessage(threadId);
      baseTurnIndex = added.turn_index;
      userContentForPrompt = userMessage;
      pinnedDocsForPrompt = pinnedDocs;
    }

    // Refresh history after all mutations
    const freshHistory = this.sqlite.listMessages(threadId);

    // Summarization: if too long, summarize older turns
    let summaryText = summaryRecord?.summary || '';
    const tokenCount = freshHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    if (tokenCount > MAX_TOKENS) {
      const keepRecent = 6; // last 3 exchanges
      const old = freshHistory.slice(0, Math.max(0, freshHistory.length - keepRecent));
      if (old.length > 0) {
        const prompt = `Summarize the following conversation. Keep key topics, files, decisions.\n\n${old.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`;
        const summaryResponse = await this.summarizationModel.invoke([new HumanMessage(prompt)]);
        summaryText = typeof summaryResponse.content === 'string' ? summaryResponse.content : JSON.stringify(summaryResponse.content);
        const lastTurn = old[old.length - 1].turn_index;
        this.sqlite.upsertSummary({
          conversation_id: threadId,
          summary: summaryText,
          archived_upto_turn: lastTurn,
          updated_at: Date.now(),
        });
        // Remove summarized messages from prompt (but keep in DB for UI)
        const trimmed = freshHistory.filter(m => m.turn_index > lastTurn);
        freshHistory.length = 0;
        trimmed.forEach(m => freshHistory.push(m));
      }
    }

    // Build messages to send to model: summary + recent turns
    // Recalculate archivedUpto after potential summarization
    const currentSummary = this.sqlite.getSummary(threadId);
    const currentArchivedUpto = currentSummary?.archived_upto_turn ?? -1;
    const recentMessages = freshHistory.filter(m => m.turn_index > currentArchivedUpto);
    const maxRecent = 12;
    const trimmedRecent = recentMessages.slice(-maxRecent);

    const initialMessages: BaseMessage[] = [
      new SystemMessage(buildSystemPrompt(manifest, summaryText || undefined)),
      ...trimmedRecent
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => m.role === 'user'
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)),
    ];

    const config = {
      streamMode: 'messages' as const,
    };

    // Stream the agent response
    const stream = await graph.stream(
      { messages: initialMessages },
      config
    );

    return this.processStream(stream, threadId, baseTurnIndex);
  }

  private async *processStream(stream: AsyncIterable<any>, threadId: string, baseTurnIndex: number): AsyncGenerator<any, void, unknown> {
    // Track accumulated content for streaming text
    let accumulatedContent = '';
    let latestDraftMetadata: Record<string, unknown> | null = null;
    // Track tool calls we've already emitted (by ID)
    const emittedToolCalls = new Set<string>();
    // Accumulate tool call chunks until complete (args come in pieces)
    const pendingToolCalls = new Map<string, { name: string; args: string; emitted: boolean }>();
    
    for await (const chunk of stream) {
      // streamMode: 'messages' returns [message, metadata] tuples
      const [message, metadata] = chunk;
      
      if (!message) continue;
      
      // Handle AIMessageChunk (streaming tokens)
      if (message._getType?.() === 'ai' || message.constructor?.name === 'AIMessageChunk') {
        // Check for streaming text content
        if (message.content) {
          const content = typeof message.content === 'string' ? message.content : '';
          if (content) {
            accumulatedContent += content;
            yield {
              type: 'text',
              content: accumulatedContent,
            };
          }
        }
        
        // Check for complete tool calls (these have full args - preferred source)
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const toolCallId = toolCall.id || toolCall.name;
            if (toolCallId && toolCall.name && !emittedToolCalls.has(toolCallId)) {
              emittedToolCalls.add(toolCallId);
              yield {
                type: 'tool-call',
                toolName: toolCall.name,
                args: toolCall.args || {},
              };
            }
          }
        }
        
        // Accumulate tool_call_chunks (args come in pieces during streaming)
        // We accumulate but only emit when args are parseable as complete JSON
        if (message.tool_call_chunks && message.tool_call_chunks.length > 0) {
          for (const toolChunk of message.tool_call_chunks) {
            const toolCallId = toolChunk.id || toolChunk.index?.toString() || '0';
            
            // Skip if already emitted via complete tool_calls
            if (emittedToolCalls.has(toolCallId)) continue;
            
            // Get or create pending tool call
            let pending = pendingToolCalls.get(toolCallId);
            if (!pending) {
              pending = { name: '', args: '', emitted: false };
              pendingToolCalls.set(toolCallId, pending);
            }
            
            // Accumulate name and args
            if (toolChunk.name) {
              pending.name = toolChunk.name;
            }
            if (toolChunk.args) {
              pending.args += typeof toolChunk.args === 'string' ? toolChunk.args : '';
            }
            
            // Only emit when we have name AND can parse complete args
            if (pending.name && !pending.emitted) {
              // Try to parse args - only emit if parsing succeeds (args are complete)
              if (pending.args) {
                try {
                  const parsedArgs = JSON.parse(pending.args);
                  // Args are complete! Emit now
                  pending.emitted = true;
                  emittedToolCalls.add(toolCallId);
                  yield {
                    type: 'tool-call',
                    toolName: pending.name,
                    args: parsedArgs,
                  };
                } catch {
                  // Args not complete yet - keep accumulating, don't emit
                }
              }
            }
          }
        }
      }
      
      // Handle ToolMessage (tool results)
      if (message._getType?.() === 'tool' || message.constructor?.name === 'ToolMessage') {
        // Before emitting result, check if we have any pending tool calls that weren't emitted
        // This can happen if tool_calls array wasn't received but tool executed anyway
        for (const [id, pending] of pendingToolCalls) {
          if (!pending.emitted && pending.name && !emittedToolCalls.has(id)) {
            pending.emitted = true;
            emittedToolCalls.add(id);
            let args = {};
            try {
              args = pending.args ? JSON.parse(pending.args) : {};
            } catch {
              // If args still can't be parsed, emit with empty args
            }
            yield {
              type: 'tool-call',
              toolName: pending.name,
              args,
            };
          }
        }
        
        const toolResult = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

        if ((message.name || 'unknown') === 'create_document') {
          try {
            const parsed = JSON.parse(toolResult);
            if (
              parsed &&
              (parsed.status === 'created' || parsed.status === 'updated' || parsed.status === 'restored') &&
              parsed.draft &&
              typeof parsed.draft === 'object'
            ) {
              latestDraftMetadata = {
                status: parsed.status,
                draft: parsed.draft,
              };
            }
          } catch {
            // Ignore malformed tool result payloads.
          }
        }

        yield {
          type: 'tool-result',
          toolName: message.name || 'unknown',
          result: toolResult,
        };
        // Reset accumulated content after tool result (new response may follow)
        accumulatedContent = '';
      }
    }

    if (!accumulatedContent && latestDraftMetadata) {
      accumulatedContent = 'Prepared a document draft for your review.';
      yield {
        type: 'text',
        content: accumulatedContent,
      };
    }

    // After streaming completes, persist assistant message
    if (accumulatedContent) {
      this.sqlite.addMessage({
        id: uuidv4(),
        conversation_id: threadId,
        role: 'assistant',
        content: accumulatedContent,
        turn_index: baseTurnIndex + 1,
        metadata: latestDraftMetadata
          ? {
              document_draft: latestDraftMetadata,
            }
          : undefined,
      });
      this.sqlite.updateConversationLastMessage(threadId);
    }
  }

  /**
   * Run the agent and return just the final text response (non-streaming).
   */
  async runSync(
    userMessage: string,
    manifest: string,
    threadId: string,
    pinnedDocs: string[] = []
  ): Promise<string> {
    const graph = this.buildGraph(manifest);
    
    const config = {
      configurable: { thread_id: threadId },
    };

    // Check if system message already exists for this thread; inject once if missing
    const existingState = await graph.getState({ configurable: { thread_id: threadId } });
    const hasSystemMessage = existingState?.values?.messages?.some((m: BaseMessage) => m._getType() === 'system');
    const initialMessages: BaseMessage[] = [];

    if (!hasSystemMessage) {
      initialMessages.push(new SystemMessage(buildSystemPrompt(manifest, existingState?.values?.summary || undefined)));
    }

    // Append pinned docs to user message if present
    let userMessageWithPinnedDocs = userMessage;
    if (pinnedDocs.length > 0) {
      const pinnedDocsList = pinnedDocs.map((p, i) => `${i + 1}. ${p}`).join('\n');
      userMessageWithPinnedDocs = `${userMessage}\n\n---\n**Pinned Documents** (search these first):\n${pinnedDocsList}`;
    }

    initialMessages.push(new HumanMessage(userMessageWithPinnedDocs));

    const result = await graph.invoke(
      { messages: initialMessages },
      config
    );

    // Get the last AI message
    const lastMessage = result.messages[result.messages.length - 1];
    return typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
  }

  /**
   * Get the conversation history for a thread
   */
  async getThreadHistory(threadId: string): Promise<BaseMessage[]> {
    const rows = this.sqlite.listMessages(threadId);
    return rows.map((m) => m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content));
  }

  /**
   * Delete a thread's history
   */
  async deleteThread(threadId: string): Promise<void> {
    // Note: SqliteSaver may not have deleteThread directly exposed
    // We'll need to handle this at a lower level if needed
    console.error(`[Memory] Delete thread ${threadId} requested`);
  }
}
