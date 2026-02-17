import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { basename, join } from 'node:path';

import { parsePdf } from '../parsers/pdf.js';
import {
  MAX_VISION_MIGRATION_RETRIES,
  PDF_TEXT_EXTRACTION_VERSION,
  PDF_VISION_EXTRACTION_VERSION,
  VISION_DOC_MAX_ATTEMPTS,
  VISION_RETRY_BASE_DELAY_MS,
  isVisionExtractionEnabled,
} from './constants.js';
import { convertPdfToImages } from './documentConverter.js';
import { VisionExtractor } from './visionExtractor.js';

type ParseMetadata = Record<string, unknown>;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export interface IndexingParseOptions {
  onProgress?: (message: string) => void;
  existingMetadata?: Record<string, unknown>;
}

export interface IndexingParseResult {
  text: string;
  metadata: ParseMetadata;
}

function toDocPageContent(fileName: string, pageNumber: number, body: string): string {
  return `[Doc: ${fileName}] [Page ${pageNumber}]\n${body}`.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSafeRetryCount(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function buildRetryMetadata(existingMetadata?: Record<string, unknown>): ParseMetadata {
  const previousRetryCount = toSafeRetryCount(existingMetadata?.vision_retry_count);
  const retryCount = previousRetryCount + 1;
  const retryExhausted = retryCount >= MAX_VISION_MIGRATION_RETRIES;

  if (retryExhausted) {
    return {
      vision_retry_count: retryCount,
      vision_retry_exhausted: true,
      vision_next_retry_at: null,
    };
  }

  const retryDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    VISION_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, retryCount - 1))
  );

  return {
    vision_retry_count: retryCount,
    vision_retry_exhausted: false,
    vision_next_retry_at: Date.now() + retryDelay,
  };
}

function getDocumentRetryDelayMs(attempt: number): number {
  return Math.min(12_000, 1_500 * Math.pow(2, Math.max(0, attempt - 1)));
}

async function fallbackToTextExtraction(
  filePath: string,
  fileName: string,
  reason: string,
  options?: IndexingParseOptions,
  extractionVersion: string = PDF_TEXT_EXTRACTION_VERSION,
  extraMetadata: ParseMetadata = {}
): Promise<IndexingParseResult> {
  options?.onProgress?.(`Falling back to text parser: ${reason}`);
  const text = await parsePdf(filePath);
  return {
    text: toDocPageContent(fileName, 1, text || '[No extractable text found]'),
    metadata: {
      extraction_engine: 'text',
      extraction_version: extractionVersion,
      fallback_reason: reason,
      ...extraMetadata,
    },
  };
}

export async function parsePdfForIndexing(
  filePath: string,
  options?: IndexingParseOptions
): Promise<IndexingParseResult> {
  const fileName = basename(filePath);

  if (!isVisionExtractionEnabled()) {
    return fallbackToTextExtraction(filePath, fileName, 'VISION_ENABLED is not true', options);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackToTextExtraction(filePath, fileName, 'OPENAI_API_KEY is missing', options);
  }

  const extractor = new VisionExtractor(apiKey);

  for (let attempt = 1; attempt <= VISION_DOC_MAX_ATTEMPTS; attempt += 1) {
    const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'atlas-pdf-vision-'));

    try {
      options?.onProgress?.(`Converting PDF pages to images (attempt ${attempt}/${VISION_DOC_MAX_ATTEMPTS})`);
      const pageImages = await convertPdfToImages(filePath, tempDir);

      if (pageImages.length === 0) {
        if (attempt < VISION_DOC_MAX_ATTEMPTS) {
          const retryDelay = getDocumentRetryDelayMs(attempt);
          options?.onProgress?.(
            `No page images produced. Retrying document in ${retryDelay}ms (attempt ${attempt + 1}/${VISION_DOC_MAX_ATTEMPTS})`
          );
          await sleep(retryDelay);
          continue;
        }

        return fallbackToTextExtraction(
          filePath,
          fileName,
          'No pages were produced from PDF conversion',
          options,
          PDF_VISION_EXTRACTION_VERSION,
          buildRetryMetadata(options?.existingMetadata)
        );
      }

      options?.onProgress?.(`Prepared ${pageImages.length} page image(s) for vision extraction`);

      const pageResults = await extractor.extractPages(pageImages, {
        maxConcurrent: 4,
        maxRetries: 2,
        timeoutMs: 30_000,
        onProgress: options?.onProgress,
      });

      const successfulPages = pageResults.filter((page) => page.success);

      if (successfulPages.length === 0) {
        if (attempt < VISION_DOC_MAX_ATTEMPTS) {
          const retryDelay = getDocumentRetryDelayMs(attempt);
          options?.onProgress?.(
            `Vision failed for all pages. Retrying document in ${retryDelay}ms (attempt ${attempt + 1}/${VISION_DOC_MAX_ATTEMPTS})`
          );
          await sleep(retryDelay);
          continue;
        }

        return fallbackToTextExtraction(
          filePath,
          fileName,
          'Vision failed for all pages',
          options,
          PDF_VISION_EXTRACTION_VERSION,
          buildRetryMetadata(options?.existingMetadata)
        );
      }

      const combinedContent = pageResults
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((page) => {
          if (page.success) {
            const content = page.content.trim() || '[No content extracted for this page]';
            return toDocPageContent(fileName, page.pageNumber, content);
          }
          return toDocPageContent(
            fileName,
            page.pageNumber,
            `[Page extraction failed after retries: ${page.error || 'Unknown error'}]`
          );
        })
        .join('\n\n');

      return {
        text: combinedContent,
        metadata: {
          extraction_engine: 'vision',
          extraction_version: PDF_VISION_EXTRACTION_VERSION,
        },
      };
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || error || 'Unknown extraction error');
      if (attempt < VISION_DOC_MAX_ATTEMPTS) {
        const retryDelay = getDocumentRetryDelayMs(attempt);
        options?.onProgress?.(
          `Vision pipeline failed: ${message}. Retrying document in ${retryDelay}ms (attempt ${attempt + 1}/${VISION_DOC_MAX_ATTEMPTS})`
        );
        await sleep(retryDelay);
        continue;
      }

      return fallbackToTextExtraction(
        filePath,
        fileName,
        `Vision pipeline failed: ${message}`,
        options,
        PDF_VISION_EXTRACTION_VERSION,
        buildRetryMetadata(options?.existingMetadata)
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  return fallbackToTextExtraction(
    filePath,
    fileName,
    'Vision pipeline failed unexpectedly',
    options,
    PDF_VISION_EXTRACTION_VERSION,
    buildRetryMetadata(options?.existingMetadata)
  );
}
