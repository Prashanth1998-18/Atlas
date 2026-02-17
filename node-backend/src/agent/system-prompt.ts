import * as fs from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Build the workspace file manifest as XML for context injection.
 */
async function buildManifest(workspacePath: string): Promise<string> {
  const entries: string[] = [];
  
  const walk = async (dir: string, depth: number = 0) => {
    if (depth > 5) return; // Limit depth to prevent huge manifests
    
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        // Skip hidden files/folders and common excludes
        if (item.name.startsWith('.') || 
            item.name === 'node_modules' || 
            item.name === '__pycache__' ||
            item.name === 'target' ||
            item.name === 'dist' ||
            item.name === 'build') {
          continue;
        }
        
        const fullPath = join(dir, item.name);
        const relativePath = relative(workspacePath, fullPath);
        const indent = '  '.repeat(depth);
        
        if (item.isDirectory()) {
          entries.push(`${indent}<folder name="${item.name}">`);
          await walk(fullPath, depth + 1);
          entries.push(`${indent}</folder>`);
        } else {
          const ext = item.name.split('.').pop()?.toLowerCase() || '';
          const isIndexable = ['pdf', 'docx', 'md', 'txt', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'json', 'yaml', 'yml', 'toml', 'html', 'css'].includes(ext);
          entries.push(`${indent}<file name="${item.name}" path="${relativePath}"${isIndexable ? ' indexable="true"' : ''}/>`);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  };
  
  await walk(workspacePath);
  
  if (entries.length === 0) {
    return '<workspace><empty/></workspace>';
  }
  
  return `<workspace path="${workspacePath}">\n${entries.join('\n')}\n</workspace>`;
}

/**
 * Generate the system prompt for the Atlas agent.
 */
export async function getSystemPrompt(workspacePath: string): Promise<string> {
  const manifest = await buildManifest(workspacePath);
  
  return `You are Atlas, an intelligent document assistant designed to help users understand, search, and analyze their documents.

## Your Capabilities

1. **Document Search**: You can search documents using:
   - \`grep_search\`: Find exact text matches across files
   - \`semantic_search\`: Find conceptually related content using vector similarity
   - \`hybrid_search\`: Combine both methods for comprehensive results

2. **File Operations**: You can:
   - \`list_directory\`: Browse the workspace structure
   - \`read_file\`: Read file contents
   - \`read_file_chunk\`: Read specific line ranges (for large files)
   - \`get_file_info\`: Get file metadata

3. **Task Planning**: For complex requests, use:
   - \`todo_write\`: Create a task list to track multi-step work
   - \`todo_read\`: Check current task progress

## Guidelines

- **Be thorough**: When searching, try multiple approaches if the first doesn't yield results
- **Be concise**: Provide clear, focused answers
- **Cite sources**: Reference specific files and line numbers when quoting content
- **Ask for clarification**: If a request is ambiguous, ask before proceeding
- **Respect boundaries**: Only access files within the workspace

## Current Workspace

${manifest}

## Response Format

- Use markdown for formatting
- Use code blocks with language tags for code
- Use bullet points for lists
- Keep responses focused and actionable`;
}
