import * as fs from 'node:fs/promises';

export interface TextMetadata {
  lineCount: number;
  wordCount: number;
  charCount: number;
  encoding: string;
}

/**
 * Parse a plain text file and extract content with metadata.
 */
export async function parseText(path: string): Promise<{ text: string; metadata: TextMetadata }> {
  const content = await fs.readFile(path, 'utf8');
  
  const lines = content.split('\n');
  const words = content.split(/\s+/).filter(w => w.length > 0);
  
  const metadata: TextMetadata = {
    lineCount: lines.length,
    wordCount: words.length,
    charCount: content.length,
    encoding: 'utf8',
  };
  
  return { text: content, metadata };
}

/**
 * Simple text extraction without metadata.
 */
export async function parseTextSimple(path: string): Promise<string> {
  return await fs.readFile(path, 'utf8');
}
