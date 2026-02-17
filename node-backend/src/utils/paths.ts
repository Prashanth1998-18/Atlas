/**
 * Path utilities for workspace sandboxing and validation.
 */

import { join, resolve, relative, isAbsolute, normalize } from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * Ensure a path is within the workspace (prevent directory traversal attacks).
 */
export function isPathWithinWorkspace(workspacePath: string, targetPath: string): boolean {
  const normalizedWorkspace = normalize(resolve(workspacePath));
  const normalizedTarget = normalize(resolve(workspacePath, targetPath));
  
  return normalizedTarget.startsWith(normalizedWorkspace);
}

/**
 * Resolve a relative path within the workspace, throwing if it escapes.
 */
export function safeResolvePath(workspacePath: string, relativePath: string): string {
  const fullPath = resolve(workspacePath, relativePath);
  
  if (!isPathWithinWorkspace(workspacePath, relativePath)) {
    throw new Error(`Path "${relativePath}" escapes workspace boundary.`);
  }
  
  return fullPath;
}

/**
 * Get a path relative to the workspace root.
 */
export function getRelativePath(workspacePath: string, fullPath: string): string {
  return relative(workspacePath, fullPath);
}

/**
 * Check if a path exists.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a file.
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Get the file extension (lowercase, with dot).
 */
export function getExtension(path: string): string {
  const parts = path.split('.');
  if (parts.length < 2) return '';
  return '.' + parts.pop()!.toLowerCase();
}

/**
 * Get the filename without extension.
 */
export function getBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  const filename = parts.pop() || '';
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
}

/**
 * Normalize path separators to forward slashes (for consistent display).
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Join paths with forward slashes.
 */
export function joinPaths(...paths: string[]): string {
  return normalizeSlashes(join(...paths));
}

/**
 * Patterns to ignore when scanning workspaces.
 */
export const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  '*.pyc',
  '*.pyo',
  '.atlas', // Our own data directory
];

/**
 * Check if a path should be ignored based on common patterns.
 */
export function shouldIgnorePath(path: string): boolean {
  const parts = normalizeSlashes(path).split('/');
  
  for (const part of parts) {
    // Check directory/file names
    if (IGNORE_PATTERNS.includes(part)) {
      return true;
    }
    
    // Check patterns with wildcards
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.startsWith('*')) {
        const ext = pattern.substring(1);
        if (part.endsWith(ext)) {
          return true;
        }
      }
    }
    
    // Skip hidden files/directories
    if (part.startsWith('.') && part !== '.') {
      return true;
    }
  }
  
  return false;
}
