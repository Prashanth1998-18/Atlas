/**
 * LLM client wrapper for LangChain OpenAI integration.
 * Provides a unified interface for LLM interactions.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM client using LangChain's ChatOpenAI.
 */
export class LLMClient {
  private model: ChatOpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.model = new ChatOpenAI({
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
    });
  }

  /**
   * Generate a response from the LLM.
   */
  async generate(options: {
    system?: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<string> {
    const langchainMessages: any[] = [];

    if (options.system) {
      langchainMessages.push(new SystemMessage(options.system));
    }

    for (const msg of options.messages) {
      if (msg.role === 'user') {
        langchainMessages.push(new HumanMessage(msg.content));
      }
    }

    const result = await this.model.invoke(langchainMessages);
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  }

  /**
   * Stream a response from the LLM.
   */
  async *stream(options: {
    system?: string;
    messages: Array<{ role: string; content: string }>;
  }): AsyncGenerator<string, void, unknown> {
    const langchainMessages: any[] = [];

    if (options.system) {
      langchainMessages.push(new SystemMessage(options.system));
    }

    for (const msg of options.messages) {
      if (msg.role === 'user') {
        langchainMessages.push(new HumanMessage(msg.content));
      }
    }

    const stream = await this.model.stream(langchainMessages);
    
    for await (const chunk of stream) {
      if (typeof chunk.content === 'string') {
        yield chunk.content;
      }
    }
  }

  /**
   * Get the current model name.
   */
  getModelName(): string {
    return this.config.model;
  }

  /**
   * Update the model configuration.
   */
  setModel(model: string): void {
    this.config.model = model;
    this.model = new ChatOpenAI({
      model,
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens,
    });
  }
}

/**
 * Default model configuration.
 */
export const DEFAULT_MODEL = 'gpt-5.2';

/**
 * Create a client with default settings.
 */
export function createDefaultClient(): LLMClient {
  return new LLMClient({
    model: DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 8192,
  });
}
