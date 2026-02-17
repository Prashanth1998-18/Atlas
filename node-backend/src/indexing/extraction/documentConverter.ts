import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';

import type { PageImage } from './types.js';

type ConvertedPage = {
  path?: string;
  width?: number;
  height?: number;
  content?: Uint8Array;
};

const require = createRequire(import.meta.url);

export async function convertPdfToImages(pdfPath: string, outputDir: string): Promise<PageImage[]> {
  const converter = require('pdf-to-png-converter') as {
    pdfToPng?: (inputPath: string, options: Record<string, unknown>) => Promise<ConvertedPage[]>;
  };

  if (!converter?.pdfToPng) {
    throw new Error('pdf-to-png-converter is not available');
  }

  const convertedPages = await converter.pdfToPng(pdfPath, {
    outputFolder: outputDir,
    viewportScale: 2.0,
    outputFileMask: 'page',
  });

  const images: PageImage[] = [];

  for (let i = 0; i < convertedPages.length; i += 1) {
    const page = convertedPages[i];
    const fallbackPath = join(outputDir, `page-${i + 1}.png`);
    const imagePath = page.path
      ? (isAbsolute(page.path) ? page.path : join(outputDir, page.path))
      : fallbackPath;

    if (!page.path && page.content) {
      await fs.writeFile(imagePath, Buffer.from(page.content));
    }

    const imageBuffer = page.content
      ? Buffer.from(page.content)
      : await fs.readFile(imagePath);

    images.push({
      pageNumber: i + 1,
      imagePath,
      base64: imageBuffer.toString('base64'),
      width: page.width,
      height: page.height,
    });
  }

  return images;
}

