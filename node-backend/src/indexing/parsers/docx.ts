import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mammoth = require('mammoth');

export async function parseDocx(path: string): Promise<string> {
  const dataBuffer = await fs.readFile(path);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  
  if (!result.value || result.value.trim() === '') {
    // Check for any messages/warnings from mammoth
    if (result.messages && result.messages.length > 0) {
      const warnings = result.messages.map((m: any) => m.message).join('; ');
      throw new Error(`Document parsing produced no text. Warnings: ${warnings}`);
    }
    return '[Document is empty or contains no extractable text]';
  }
  
  return result.value;
}
