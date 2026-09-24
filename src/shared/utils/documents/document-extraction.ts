import pdfParse from "pdf-parse";
import geminiVisionService from "../../providers/ai/gemini-vision.service";

const DEFAULT_MIN_NATIVE_TEXT_LENGTH = 40;

// Pipeline compartilhado por qualquer extração estruturada via IA neste
// projeto (comprovante hoje, DANFE fotografado amanhã): PDF nativo/digital
// tem o texto extraído localmente (pdf-parse, sem custo de visão
// computacional); foto ou PDF escaneado (sem texto suficiente) vai direto
// pro Gemini como binário.
export async function extractStructuredDataFromDocument(params: {
  buffer: Buffer;
  mimeType: string;
  prompt: string;
  minNativeTextLength?: number;
}): Promise<string> {
  if (params.mimeType === "application/pdf") {
    let nativeText = "";
    try {
      const parsed = await pdfParse(params.buffer);
      nativeText = parsed.text ?? "";
    } catch {
      nativeText = "";
    }

    if (
      nativeText.trim().length >=
      (params.minNativeTextLength ?? DEFAULT_MIN_NATIVE_TEXT_LENGTH)
    ) {
      return geminiVisionService.extractFromText({
        text: nativeText,
        prompt: params.prompt,
      });
    }
  }

  return geminiVisionService.extractFromInlineData({
    buffer: params.buffer,
    mimeType: params.mimeType,
    prompt: params.prompt,
  });
}
