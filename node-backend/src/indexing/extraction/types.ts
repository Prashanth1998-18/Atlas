export interface PageImage {
  pageNumber: number;
  imagePath: string;
  base64: string;
  width?: number;
  height?: number;
}

export interface VisionPageResult {
  pageNumber: number;
  content: string;
  success: boolean;
  error?: string;
}

export interface VisionExtractorConfig {
  maxConcurrent?: number;
  maxRetries?: number;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

