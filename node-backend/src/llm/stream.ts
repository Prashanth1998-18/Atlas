/**
 * Stream handling utilities for LLM responses.
 * Handles thinking blocks and response streaming.
 */

export interface StreamPart {
  type: 'thinking' | 'text' | 'tool-call' | 'tool-result' | 'finish';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: any;
  };
  toolResult?: {
    toolCallId: string;
    result: any;
  };
}

export interface StreamHandler {
  onThinking?: (text: string) => void;
  onText?: (text: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; arguments: any }) => void;
  onToolResult?: (result: { toolCallId: string; result: any }) => void;
  onFinish?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Process a stream from the Vercel AI SDK and emit typed events.
 */
export async function processStream(
  stream: AsyncIterable<any>,
  handler: StreamHandler
): Promise<{ fullText: string; toolCalls: any[] }> {
  let fullText = '';
  const toolCalls: any[] = [];

  try {
    for await (const part of stream) {
      switch (part.type) {
        case 'text-delta':
          fullText += part.textDelta;
          handler.onText?.(part.textDelta);
          break;

        case 'tool-call':
          const toolCall = {
            id: part.toolCallId,
            name: part.toolName,
            arguments: part.args,
          };
          toolCalls.push(toolCall);
          handler.onToolCall?.(toolCall);
          break;

        case 'tool-result':
          handler.onToolResult?.({
            toolCallId: part.toolCallId,
            result: part.result,
          });
          break;

        case 'finish':
          handler.onFinish?.();
          break;
      }
    }
  } catch (error) {
    handler.onError?.(error as Error);
    throw error;
  }

  return { fullText, toolCalls };
}

/**
 * Create a stream emitter for IPC communication.
 */
export function createStreamEmitter(
  requestId: string,
  emit: (data: any) => void
): StreamHandler {
  return {
    onThinking: (text) => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'thinking', content: text },
      });
    },
    onText: (text) => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'text', content: text },
      });
    },
    onToolCall: (toolCall) => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'tool-call', toolCall },
      });
    },
    onToolResult: (result) => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'tool-result', toolResult: result },
      });
    },
    onFinish: () => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'finish' },
      });
    },
    onError: (error) => {
      emit({
        jsonrpc: '2.0',
        method: 'chat.stream',
        params: { id: requestId, type: 'error', error: error.message },
      });
    },
  };
}

/**
 * Buffer stream parts for batched processing.
 */
export class StreamBuffer {
  private buffer: StreamPart[] = [];
  private flushInterval: number;
  private flushCallback: (parts: StreamPart[]) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(flushCallback: (parts: StreamPart[]) => void, flushInterval: number = 50) {
    this.flushCallback = flushCallback;
    this.flushInterval = flushInterval;
  }

  push(part: StreamPart): void {
    this.buffer.push(part);
    
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    if (this.buffer.length > 0) {
      this.flushCallback([...this.buffer]);
      this.buffer = [];
    }
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
