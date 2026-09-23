import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_MODEL = "gemini-3.6-flash";
// 500/503 do Gemini são quase sempre pico de demanda passageiro (visto em produção) — vale retry.
const RETRYABLE_STATUSES = new Set([500, 503]);
// A análise roda em background (ver PdvSalesRequestService.attachReceiptAndShippingType)
// e não bloqueia mais a resposta HTTP — pode ser mais tolerante aqui sem
// piorar a UX, importante com várias lojas subindo comprovante ao mesmo tempo.
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 1000;

// Cliente único, prompt-parametrizado — não sabe nada sobre comprovante,
// DANFE ou qualquer outro domínio específico. Cada caller (payment-receipt-
// extraction.service.ts, danfe-interpreter.ts) traz seu próprio prompt.
export class GeminiVisionService {
  private client: GoogleGenerativeAI | null = null;
  private modelName: string;

  constructor() {
    this.modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  }

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY não configurada");
      }
      this.client = new GoogleGenerativeAI(apiKey);
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
    const model = this.getClient().getGenerativeModel({
      model: this.modelName,
    });
    const result = await this.withRetry(() =>
      model.generateContent([params.prompt, params.text]),
    );
    return result.response.text();
  }

  async extractFromInlineData(params: {
    buffer: Buffer;
    mimeType: string;
    prompt: string;
  }): Promise<string> {
    const model = this.getClient().getGenerativeModel({
      model: this.modelName,
    });
    const result = await this.withRetry(() =>
      model.generateContent([
        params.prompt,
        {
          inlineData: {
            data: params.buffer.toString("base64"),
            mimeType: params.mimeType,
          },
        },
      ]),
    );
    return result.response.text();
  }
}

export default new GeminiVisionService();
