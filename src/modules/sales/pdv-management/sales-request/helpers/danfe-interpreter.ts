import pdfParse from "pdf-parse";
import { extractStructuredDataFromDocument } from "../../../../../shared/utils/documents/document-extraction";
import { DANFE_ACCESS_KEY_EXTRACTION_PROMPT } from "./danfe-access-key-prompt";

const ACCESS_KEY_DIGITS = 44;
const ACCESS_KEY_REGEX = /(\d[\d\s.]{42,80}\d)/;

function extractDigits(text: string): string | null {
  const match = text.match(ACCESS_KEY_REGEX);
  if (!match) return null;

  const digitsOnly = match[1].replace(/\D/g, "");
  return digitsOnly.length === ACCESS_KEY_DIGITS ? digitsOnly : null;
}

// PDF nativo (texto selecionável) resolve na hora, sem IA, via regex local.
// Documento escaneado/fotografado (ou PDF sem chave legível no texto nativo)
// cai pro pipeline compartilhado de IA (Passo B) como fallback.
export async function extractAccessKeyFromDanfe(
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  if (mimeType === "application/pdf") {
    try {
      const parsed = await pdfParse(buffer);
      const fromNativeText = extractDigits(parsed.text ?? "");
      if (fromNativeText) return fromNativeText;
    } catch {
      // segue pro fallback via IA abaixo
    }
  }

  try {
    const aiResponse = await extractStructuredDataFromDocument({
      buffer,
      mimeType,
      prompt: DANFE_ACCESS_KEY_EXTRACTION_PROMPT,
    });
    return extractDigits(aiResponse);
  } catch (err) {
    console.warn(
      "[PDV] Falha ao extrair chave de acesso do DANFE via IA",
      err,
    );
    return null;
  }
}
