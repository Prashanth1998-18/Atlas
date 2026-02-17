export const PDF_VISION_EXTRACTION_VERSION = 'vision_pdf_v1';
export const PDF_TEXT_EXTRACTION_VERSION = 'text_pdf_v0';
export const MAX_VISION_MIGRATION_RETRIES = 3;
export const VISION_RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
export const VISION_DOC_MAX_ATTEMPTS = 3;

export function isVisionExtractionEnabled(): boolean {
  return (process.env.VISION_ENABLED || '').toLowerCase() === 'true';
}
