/**
 * Custom error types for Atlas.
 */

/**
 * Base error class for Atlas errors.
 */
export class AtlasError extends Error {
  public code: string;
  public details?: Record<string, any>;

  constructor(message: string, code: string, details?: Record<string, any>) {
    super(message);
    this.name = 'AtlasError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Error thrown when a workspace operation fails.
 */
export class WorkspaceError extends AtlasError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'WORKSPACE_ERROR', details);
    this.name = 'WorkspaceError';
  }
}

/**
 * Error thrown when a file operation fails.
 */
export class FileError extends AtlasError {
  public path?: string;

  constructor(message: string, path?: string, details?: Record<string, any>) {
    super(message, 'FILE_ERROR', { ...details, path });
    this.name = 'FileError';
    this.path = path;
  }
}

/**
 * Error thrown when a file is not found.
 */
export class FileNotFoundError extends FileError {
  constructor(path: string) {
    super(`File not found: ${path}`, path);
    this.name = 'FileNotFoundError';
    this.code = 'FILE_NOT_FOUND';
  }
}

/**
 * Error thrown when access is denied.
 */
export class AccessDeniedError extends AtlasError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'ACCESS_DENIED', details);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Error thrown when a path escapes the workspace boundary.
 */
export class PathEscapeError extends AccessDeniedError {
  constructor(path: string) {
    super(`Path escapes workspace boundary: ${path}`, { path });
    this.name = 'PathEscapeError';
    this.code = 'PATH_ESCAPE';
  }
}

/**
 * Error thrown when indexing fails.
 */
export class IndexingError extends AtlasError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'INDEXING_ERROR', details);
    this.name = 'IndexingError';
  }
}

/**
 * Error thrown when parsing a document fails.
 */
export class ParseError extends AtlasError {
  public path?: string;
  public fileType?: string;

  constructor(message: string, path?: string, fileType?: string, details?: Record<string, any>) {
    super(message, 'PARSE_ERROR', { ...details, path, fileType });
    this.name = 'ParseError';
    this.path = path;
    this.fileType = fileType;
  }
}

/**
 * Error thrown when an LLM call fails.
 */
export class LLMError extends AtlasError {
  public provider?: string;
  public model?: string;

  constructor(message: string, provider?: string, model?: string, details?: Record<string, any>) {
    super(message, 'LLM_ERROR', { ...details, provider, model });
    this.name = 'LLMError';
    this.provider = provider;
    this.model = model;
  }
}

/**
 * Error thrown when a tool execution fails.
 */
export class ToolError extends AtlasError {
  public toolName?: string;

  constructor(message: string, toolName?: string, details?: Record<string, any>) {
    super(message, 'TOOL_ERROR', { ...details, toolName });
    this.name = 'ToolError';
    this.toolName = toolName;
  }
}

/**
 * Error thrown when vector search fails.
 */
export class VectorSearchError extends AtlasError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VECTOR_SEARCH_ERROR', details);
    this.name = 'VectorSearchError';
  }
}

/**
 * Error thrown when embeddings generation fails.
 */
export class EmbeddingError extends AtlasError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'EMBEDDING_ERROR', details);
    this.name = 'EmbeddingError';
  }
}

/**
 * Convert any error to an AtlasError.
 */
export function toAtlasError(error: unknown): AtlasError {
  if (error instanceof AtlasError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new AtlasError(error.message, 'UNKNOWN_ERROR', {
      originalName: error.name,
      stack: error.stack,
    });
  }
  
  return new AtlasError(String(error), 'UNKNOWN_ERROR');
}

/**
 * Format an error for JSON-RPC response.
 */
export function formatRpcError(error: unknown): { code: number; message: string; data?: any } {
  const atlasError = toAtlasError(error);
  
  return {
    code: -32603, // Internal error
    message: atlasError.message,
    data: {
      code: atlasError.code,
      details: atlasError.details,
    },
  };
}
