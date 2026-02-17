import OpenAI from 'openai';

import type { PageImage, VisionExtractorConfig, VisionPageResult } from './types.js';

const EXTRACTION_PROMPT = `Extract all information from this image for a searchable knowledge base.

Principles:
- Every value must include what it represents
- Preserve relationships between labels and data
- Include all text, numbers, legends, and footnotes

Plain text only. No visual formatting.`;

const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CONCURRENT = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return status;
  return null;
}

function isRetryableError(error: unknown): boolean {
  const status = extractErrorStatus(error);
  if (status === 429 || (status !== null && status >= 500)) {
    return true;
  }

  const message = String((error as { message?: unknown })?.message || error).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('socket hang up')
  );
}

function normalizeContent(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '');
        }
        return '';
      })
      .filter(Boolean);
    return parts.join('\n').trim();
  }

  return '';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class VisionExtractor {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  private async extractSinglePage(page: PageImage, timeoutMs: number): Promise<string> {
    const responsePromise = this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${page.base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2_000,
    });

    const response = await withTimeout(
      responsePromise,
      timeoutMs,
      `Vision extraction timed out for page ${page.pageNumber}`
    );

    return normalizeContent(response.choices?.[0]?.message?.content);
  }

  private async extractPageWithRetries(
    page: PageImage,
    totalPages: number,
    config: VisionExtractorConfig
  ): Promise<VisionPageResult> {
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const onProgress = config.onProgress;

    let lastError: unknown = null;
    const maxAttempts = maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      onProgress?.(`Vision extracting page ${page.pageNumber}/${totalPages} (attempt ${attempt}/${maxAttempts})`);
      try {
        const content = await this.extractSinglePage(page, timeoutMs);
        onProgress?.(`Vision extracted page ${page.pageNumber}/${totalPages}`);
        return {
          pageNumber: page.pageNumber,
          content,
          success: true,
        };
      } catch (error) {
        lastError = error;
        const shouldRetry = attempt < maxAttempts && isRetryableError(error);
        if (!shouldRetry) {
          break;
        }

        const delayMs = Math.min(8_000, 500 * Math.pow(2, attempt - 1));
        onProgress?.(
          `Vision retry scheduled for page ${page.pageNumber}/${totalPages} after ${delayMs}ms`
        );
        await sleep(delayMs);
      }
    }

    const errorMessage = String((lastError as { message?: unknown })?.message || lastError || 'Unknown extraction error');
    onProgress?.(`Vision failed page ${page.pageNumber}/${totalPages}: ${errorMessage}`);
    return {
      pageNumber: page.pageNumber,
      content: '',
      success: false,
      error: errorMessage,
    };
  }

  async extractPages(pages: PageImage[], config: VisionExtractorConfig = {}): Promise<VisionPageResult[]> {
    const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const results: VisionPageResult[] = [];
    const totalPages = pages.length;

    for (let i = 0; i < pages.length; i += maxConcurrent) {
      const batch = pages.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((page) => this.extractPageWithRetries(page, totalPages, config))
      );
      results.push(...batchResults);
    }

    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  }
}

