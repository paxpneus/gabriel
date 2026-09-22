import pdfParse from "pdf-parse";

const ACCESS_KEY_DIGITS = 44;
const ACCESS_KEY_REGEX = /(\d[\d\s.]{42,80}\d)/;

// Passo A: só extrai a chave de acesso quando o DANFE é um PDF nativo (texto
// selecionável) — documento escaneado/fotografado fica indisponível até o
// Passo B (fallback via Gemini) entrar. Retorna null quando não consegue.
export async function extractAccessKeyFromDanfe(
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  if (mimeType !== "application/pdf") return null;

  let text: string;
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text ?? "";
  } catch {
    return null;
  }

  const match = text.match(ACCESS_KEY_REGEX);
  if (!match) return null;

  const digitsOnly = match[1].replace(/\D/g, "");
  return digitsOnly.length === ACCESS_KEY_DIGITS ? digitsOnly : null;
}
