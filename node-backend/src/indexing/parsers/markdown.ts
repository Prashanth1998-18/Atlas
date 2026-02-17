import * as fs from 'node:fs/promises';

export interface MarkdownMetadata {
  title?: string;
  headings: string[];
  hasCodeBlocks: boolean;
  hasTables: boolean;
  linkCount: number;
}

/**
 * Parse a Markdown file and extract its content with metadata.
 */
export async function parseMarkdown(path: string): Promise<{ text: string; metadata: MarkdownMetadata }> {
  const content = await fs.readFile(path, 'utf8');
  
  // Extract metadata
  const metadata: MarkdownMetadata = {
    headings: [],
    hasCodeBlocks: false,
    hasTables: false,
    linkCount: 0,
  };
  
  // Extract title (first H1)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }
  
  // Extract all headings
  const headingMatches = content.matchAll(/^(#{1,6})\s+(.+)$/gm);
  for (const match of headingMatches) {
    metadata.headings.push(match[2].trim());
  }
  
  // Check for code blocks
  metadata.hasCodeBlocks = /```[\s\S]*?```/.test(content);
  
  // Check for tables
  metadata.hasTables = /\|.+\|/.test(content);
  
  // Count links
  const linkMatches = content.match(/\[.+?\]\(.+?\)/g);
  metadata.linkCount = linkMatches ? linkMatches.length : 0;
  
  // Clean the text for indexing (remove markdown syntax but keep content)
  let cleanedText = content
    // Remove code blocks (keep content)
    .replace(/```[\w]*\n([\s\S]*?)```/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images but keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove emphasis markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove headers markers but keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return { text: cleanedText, metadata };
}

/**
 * Simple text extraction without metadata (for basic use cases).
 */
export async function parseMarkdownSimple(path: string): Promise<string> {
  const { text } = await parseMarkdown(path);
  return text;
}
