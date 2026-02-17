export interface Chunk {
  content: string;
  metadata: {
    pageNumber?: number;
    sectionHeading?: string;
    [key: string]: any;
  };
}

export class Chunker {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(chunkSize: number = 1000, chunkOverlap: number = 200) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  splitText(text: string, metadata: any = {}): Chunk[] {
    const chunks: Chunk[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const content = text.substring(start, end);
      chunks.push({
        content,
        metadata: { ...metadata }
      });
      start += (this.chunkSize - this.chunkOverlap);
      if (start >= text.length) break;
    }

    return chunks;
  }
}
