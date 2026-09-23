import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_MODEL = "gemini-2.0-flash";

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

  async extractFromText(params: {
    text: string;
    prompt: string;
  }): Promise<string> {
    const model = this.getClient().getGenerativeModel({
      model: this.modelName,
    });
    const result = await model.generateContent([
      params.prompt,
      params.text,
    ]);
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
    const result = await model.generateContent([
      params.prompt,
      {
        inlineData: {
          data: params.buffer.toString("base64"),
          mimeType: params.mimeType,
        },
      },
    ]);
    return result.response.text();
  }
}

export default new GeminiVisionService();
