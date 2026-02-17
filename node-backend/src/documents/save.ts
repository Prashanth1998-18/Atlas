import * as fs from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

export type DocumentFormat = 'md' | 'docx' | 'txt';

export interface SaveDocumentInput {
  workspacePath: string;
  filename: string;
  content: string;
  location: string;
  format: DocumentFormat;
}

export interface SaveDocumentResult {
  relative_path: string;
  filename: string;
  location: string;
  format: DocumentFormat;
  fallback_to_md: boolean;
  location_fallback_to_root: boolean;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.docx']);
const DOCX_CONVERSION_MAX_RETRIES = 2;

function sanitizeFilename(rawFilename: string): string {
  let value = String(rawFilename || '').trim();
  if (!value) value = 'document';

  // Remove illegal filename characters on common desktop filesystems.
  value = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.replace(/[. ]+$/g, '');

  const currentExt = extname(value).toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(currentExt)) {
    value = value.slice(0, -currentExt.length);
  }

  if (!value) value = 'document';
  return value;
}

function normalizeLocation(rawLocation: string): string {
  const value = String(rawLocation || '').trim().replace(/\\/g, '/');
  if (!value || value === '.' || value === '/') return '';
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const normalizedRoot = resolve(workspaceRoot);
  const normalizedCandidate = resolve(candidatePath);

  const compareRoot = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot;
  const compareCandidate = process.platform === 'win32' ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const rel = relative(compareRoot, compareCandidate);

  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueFilePath(directory: string, baseName: string, extension: string): Promise<string> {
  let counter = 1;
  let candidate = join(directory, `${baseName}${extension}`);

  while (await pathExists(candidate)) {
    counter += 1;
    candidate = join(directory, `${baseName}-${counter}${extension}`);
  }

  return candidate;
}

function markdownToPlainText(markdown: string): string {
  let text = String(markdown || '');

  // Fenced code blocks: keep code content, strip fences.
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
  // Inline code.
  text = text.replace(/`([^`]+)`/g, '$1');
  // Images and links.
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, '');
  text = text.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  // Headings, quotes, lists.
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  // Basic emphasis.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  // Horizontal rules and extra whitespace.
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return `${text.trim()}\n`;
}

async function convertMarkdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const module = await import('@mohtasham/md-to-docx');
  const converter =
    (module as any).convertMarkdownToDocx ??
    (module as any).default ??
    module;

  if (typeof converter !== 'function') {
    throw new Error('DOCX converter export not found');
  }

  const output = await converter(markdown);
  if (!output) {
    throw new Error('DOCX converter returned empty output');
  }

  if (Buffer.isBuffer(output)) {
    return output;
  }

  if (output instanceof Uint8Array) {
    return Buffer.from(output);
  }

  if (typeof output.arrayBuffer === 'function') {
    const arrayBuffer = await output.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error('Unsupported DOCX converter output type');
}

async function convertMarkdownToDocxBufferWithRetry(markdown: string): Promise<Buffer> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= DOCX_CONVERSION_MAX_RETRIES; attempt += 1) {
    try {
      return await convertMarkdownToDocxBuffer(markdown);
    } catch (error) {
      lastError = error;
      if (attempt < DOCX_CONVERSION_MAX_RETRIES) {
        continue;
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('DOCX conversion failed');
}

export async function saveDocumentToWorkspace(input: SaveDocumentInput): Promise<SaveDocumentResult> {
  const workspaceRoot = resolve(input.workspacePath);
  const baseName = sanitizeFilename(input.filename);
  const requestedLocation = normalizeLocation(input.location);
  const markdownContent = String(input.content || '');

  let targetDir = workspaceRoot;
  let locationFallbackToRoot = false;
  if (requestedLocation) {
    const candidateDir = resolve(workspaceRoot, requestedLocation);
    if (isPathInsideWorkspace(workspaceRoot, candidateDir)) {
      targetDir = candidateDir;
      try {
        await fs.mkdir(targetDir, { recursive: true });
      } catch {
        targetDir = workspaceRoot;
        locationFallbackToRoot = true;
      }
    } else {
      targetDir = workspaceRoot;
      locationFallbackToRoot = true;
    }
  }

  let targetFormat: DocumentFormat = input.format;
  let extension = targetFormat === 'docx' ? '.docx' : targetFormat === 'txt' ? '.txt' : '.md';
  let fileBuffer: Buffer;
  let fallbackToMarkdown = false;

  if (targetFormat === 'txt') {
    fileBuffer = Buffer.from(markdownToPlainText(markdownContent), 'utf8');
  } else if (targetFormat === 'md') {
    fileBuffer = Buffer.from(markdownContent, 'utf8');
  } else {
    try {
      fileBuffer = await convertMarkdownToDocxBufferWithRetry(markdownContent);
    } catch {
      // Reliability-first fallback: never drop content if conversion fails.
      targetFormat = 'md';
      extension = '.md';
      fallbackToMarkdown = true;
      fileBuffer = Buffer.from(markdownContent, 'utf8');
    }
  }

  const outputPath = await getUniqueFilePath(targetDir, baseName, extension);
  await fs.writeFile(outputPath, fileBuffer);

  const relativePath = relative(workspaceRoot, outputPath).replace(/\\/g, '/');
  const relativeLocation = relative(workspaceRoot, dirname(outputPath)).replace(/\\/g, '/');
  const outputLocation = relativeLocation === '' ? '.' : relativeLocation;

  return {
    relative_path: relativePath,
    filename: outputPath.split(/[/\\]/).pop() || `${baseName}${extension}`,
    location: outputLocation,
    format: targetFormat,
    fallback_to_md: fallbackToMarkdown,
    location_fallback_to_root: locationFallbackToRoot,
  };
}
