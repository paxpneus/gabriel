import pdfParse from "pdf-parse";

// Marca de CC-e, já sem acento: título "CARTA DE CORREÇÃO" ou o cabeçalho "Nº Correção" da tabela (PDF da Bling, sem título).
const CORRECTION_LETTER_MARKER_REGEX = /CARTA\s+DE\s+CORRECAO|N[º°oO]\.?\s*CORRECAO/i;
// 44 dígitos seguidos ou em blocos de 4 separados por espaço/ponto (como a chave sai impressa).
const ACCESS_KEY_REGEX = /(?<!\d)(?:\d{4}[ .]?){10}\d{4}(?!\d)/;
// "NF-e Nº 022307" / "NF-e N° 022.307" — ponto de milhar é removido depois.
const INVOICE_NUMBER_REGEX = /NF-?e\s*N[º°oO]\.?\s*:?\s*(\d[\d.]*)/i;

export interface CorrectionLetterIdentification {
  isCorrectionLetter: boolean;
  accessKey: string | null;
  number: string | null;
}

// Lê do texto nativo do PDF (sem OCR/IA) o que identifica a nota corrigida; campo não achado volta null.
export function parseCorrectionLetterText(text: string): CorrectionLetterIdentification {
  const accessKey = text.match(ACCESS_KEY_REGEX)?.[0].replace(/\D/g, "") ?? null;
  const number = text.match(INVOICE_NUMBER_REGEX)?.[1].replace(/\D/g, "") || null;
  // NFD + remove acentos: o texto extraído pode vir com "ç"/"ã" decompostos.
  const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return { isCorrectionLetter: CORRECTION_LETTER_MARKER_REGEX.test(plain), accessKey, number };
}

// PDF → identificação da nota; PDF sem texto selecionável (foto/escaneado) volta tudo vazio.
export async function extractCorrectionLetterIdentification(buffer: Buffer): Promise<CorrectionLetterIdentification> {
  try {
    const parsed = await pdfParse(buffer);
    return parseCorrectionLetterText(parsed.text ?? "");
  } catch (err) {
    console.log(`[CORRECTION_LETTER] pdf-parse falhou: ${(err as Error)?.message ?? err}`);
    return { isCorrectionLetter: false, accessKey: null, number: null };
  }
}
