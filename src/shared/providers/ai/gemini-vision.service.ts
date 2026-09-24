import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

// No SDK novo (@google/genai), utilize gemini-2.5-flash ou gemini-2.0-flash.
// Se quiser garantir compatibilidade total, gemini-2.5-flash é a versão estável atual.
const DEFAULT_MODEL = "gemini-3.6-flash";

// Incluído 429 para que picos de chamadas simultâneas no PDV aguardem o retry
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 2000;

export class GeminiVisionService {
  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor() {
    this.modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY não configurada");
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        if (!RETRYABLE_STATUSES.has(error?.status) || attempt >= MAX_RETRIES) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)),
        );
      }
    }
  }

  async extractFromText(params: {
    text: string;
    prompt: string;
  }): Promise<string> {
    const result = await this.withRetry(() =>
      this.getClient().models.generateContent({
        model: this.modelName,
        contents: [params.prompt, params.text],
      }),
    );
    return result.text ?? "";
  }

  async extractFromInlineData(params: {
    buffer: Buffer;
    mimeType: string;
    prompt: string;
  }): Promise<string> {
    const result = await this.withRetry(() =>
      this.getClient().models.generateContent({
        model: this.modelName,
        contents: [
          params.prompt,
          {
            inlineData: {
              data: params.buffer.toString("base64"),
              mimeType: params.mimeType,
            },
          },
        ],
      }),
    );
    return result.text ?? "";
  }
}

export default new GeminiVisionService();