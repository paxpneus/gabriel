import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";
import { TESSDATA_DIR } from "../../../../../config/resource-paths";

const MIN_NATIVE_TEXT_LENGTH = 40;

// PDF nativo (texto selecionável) via pdf-parse, sem custo de OCR. Imagem
// (foto do comprovante, o caso mais comum) via Tesseract OCR local — nenhuma
// chamada externa nem IA generativa (troca do pipeline Gemini, ver
// .claude/modules/ai-vision-extraction.md). PDF sem texto nativo suficiente
// (escaneado/só imagem embutida) não tem rasterização própria aqui — cai pro
// mesmo resultado "sem texto extraído" de um documento ilegível, tratado a
// jusante como falha de IA comum (análise sai com os campos null).
export async function extractReceiptText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (mimeType === "application/pdf") {
    const nativeText = await tryNativePdfText(buffer);
    if (nativeText) return nativeText;
    return "";
  }

  return ocrImage(buffer);
}

async function tryNativePdfText(buffer: Buffer): Promise<string | null> {
  try {
    const parsed = await pdfParse(buffer);
    const text = parsed.text ?? "";
    return text.trim().length >= MIN_NATIVE_TEXT_LENGTH ? text : null;
  } catch {
    return null;
  }
}

// langPath aponta pro .traineddata baixado uma vez e versionado localmente
// (resources/tessdata/) — nunca busca em CDN externo em runtime.
// cacheMethod "none" evita o worker tentar escrever um cache decodificado em
// disco (resources/ pode estar montado read-only em produção).
async function ocrImage(buffer: Buffer): Promise<string> {
  const worker = await createWorker("por", undefined, {
    langPath: TESSDATA_DIR,
    cacheMethod: "none",
  });

  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return text ?? "";
  } finally {
    await worker.terminate();
  }
}
