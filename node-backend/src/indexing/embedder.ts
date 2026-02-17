import OpenAI from 'openai';

export class Embedder {
  private openai: OpenAI;
  private model: string = 'text-embedding-3-small';

  constructor(apiKey?: string) {
    this.openai = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((item: any) => item.embedding);
  }

  async embedText(text: string): Promise<number[]> {
    const embeddings = await this.embedTexts([text]);
    return embeddings[0];
  }
}
