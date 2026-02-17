import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export async function parsePdf(path: string): Promise<string> {
  const dataBuffer = await fs.readFile(path);
  const data = await pdf(dataBuffer);
  
  if (!data.text || data.text.trim() === '') {
    // PDF might be image-based (scanned) or encrypted
    if (data.numpages > 0) {
      return `[PDF contains ${data.numpages} page(s) but no extractable text. The document may be scanned/image-based or encrypted.]`;
    }
    return '[PDF document is empty or contains no extractable text]';
  }
  
  return data.text;
}
