import pdfParse from "pdf-parse";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";

const ACCESS_KEY_DIGITS = 44;
const ACCESS_KEY_REGEX = /(\d[\d\s.]{42,80}\d)/;
// Dois layouts observados: (1) valor ANTES do rótulo — pdf-parse extrai na
// ordem visual/posicional do PDF, e no layout padrão da Tecinco/Sefaz o
// número grande fica IMPRESSO ACIMA das legendas pequenas "Nº"/"SÉRIE" (ex.
// real: "920\n1\nNF-e\nNº\nSÉRIE"); (2) rótulo antes do valor, em linha —
// layout mais tradicional ("Nº 020.309 SÉRIE 1"). Tenta (1) primeiro (mais
// comum nos DANFEs reais processados até agora), cai pro (2) se não bater.
// Dígitos podem vir com ponto de milhar (ex. "020.309") que o OCR às vezes
// desloca (ex. "0.20309"); limpar removendo tudo que não é dígito resolve
// os dois casos, já que a ordem dos dígitos nunca muda, só a posição do
// separador.
const INVOICE_NUMBER_BEFORE_LABEL_REGEX =
  /(\d{1,15})\s*\n(?:\d{1,4}\s*\n)?(?:NF-?e\s*\n)?N[ºO°]\.?\s*\n?\s*SÉRIE/i;
const INVOICE_NUMBER_AFTER_LABEL_REGEX = /N[ºO°]\.?\s*[:.]?\s*(\d[\d.\s]{0,14}\d)/i;
const CNPJ_DIGITS = 14;
// CNPJ do emitente: no layout posicional real, o rótulo "CNPJ" (cabeçalho de
// coluna) fica LONGE do valor de verdade — colunas inteiras se
// espremem/concatenam sem espaço no texto extraído (ex. real:
// "CNPJINSCRIÇÃO ESTADUAL SUBST. TRIBUTÁRIO" bem antes de
// "...02.316.749/0023-83" aparecer). Não dá pra achar por "rótulo perto do
// valor" nesse layout — em vez disso, pega o primeiro CNPJ no formato
// padrão (##.###.###/####-##, só o emitente usa esse formato pontuado nesse
// tipo de documento) que aparece ANTES da seção "DESTINATÁRIO"/"REMETENTE"
// no texto — a nota sempre lista o emitente primeiro. Sem essa seção no
// texto (raro), usa o primeiro CNPJ formatado que encontrar.
const CNPJ_FORMATTED_REGEX = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;
const DESTINATARIO_MARKER_REGEX = /DESTINAT[ÁA]RIO/i;

export interface DanfeIdentification {
  accessKey: string | null;
  number: string | null;
  emitterCnpj: string | null;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function extractAccessKeyDigits(text: string): string | null {
  const match = text.match(ACCESS_KEY_REGEX);
  if (!match) return null;

  const digitsOnly = onlyDigits(match[1]);
  return digitsOnly.length === ACCESS_KEY_DIGITS ? digitsOnly : null;
}

function extractInvoiceNumberDigits(text: string): string | null {
  const beforeMatch = text.match(INVOICE_NUMBER_BEFORE_LABEL_REGEX);
  if (beforeMatch) {
    const digitsOnly = onlyDigits(beforeMatch[1]);
    if (digitsOnly.length > 0) return digitsOnly;
  }

  const afterMatch = text.match(INVOICE_NUMBER_AFTER_LABEL_REGEX);
  if (afterMatch) {
    const digitsOnly = onlyDigits(afterMatch[1]);
    if (digitsOnly.length > 0) return digitsOnly;
  }

  return null;
}

function extractEmitterCnpjDigits(text: string): string | null {
  const matches = [...text.matchAll(CNPJ_FORMATTED_REGEX)];
  if (matches.length === 0) return null;

  const destinatarioIndex = text.search(DESTINATARIO_MARKER_REGEX);
  const beforeDestinatario =
    destinatarioIndex === -1
      ? matches
      : matches.filter((m) => (m.index ?? 0) < destinatarioIndex);

  const chosen = (beforeDestinatario.length > 0 ? beforeDestinatario : matches)[0];
  const digitsOnly = cleanDocument(chosen[0]);
  return digitsOnly.length === CNPJ_DIGITS ? digitsOnly : null;
}

// Só regex local sobre o texto nativo do PDF — SEM fallback de IA por
// decisão explícita (era a causa de attachTransferInvoice levar ~10-30s por
// anexo, mesmo pra nota já conhecida). Documento sem texto nativo (foto/
// escaneado) ou PDF onde a regex não bate simplesmente devolve os campos que
// achou (ou null) — quem chama pede o XML da nota nesse caso, não há retry
// via IA aqui por enquanto.
export async function extractDanfeIdentification(
  buffer: Buffer,
  mimeType: string,
): Promise<DanfeIdentification> {
  let accessKey: string | null = null;
  let number: string | null = null;
  let emitterCnpj: string | null = null;
  let nativeText = "";

  if (mimeType === "application/pdf") {
    try {
      const parsed = await pdfParse(buffer);
      nativeText = parsed.text ?? "";
      accessKey = extractAccessKeyDigits(nativeText);
      number = extractInvoiceNumberDigits(nativeText);
      emitterCnpj = extractEmitterCnpjDigits(nativeText);
    } catch (err) {
      console.log(
        `[DANFE_INTERPRETER] pdf-parse falhou: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  // Diagnóstico temporário — a regex pode não bater com o layout real do
  // DANFE (varia por emissor); sem isso não dá pra saber se o problema é
  // mimeType errado, PDF sem texto nativo, ou regex desalinhada com o texto.
  if (!accessKey || !number) {
    console.log(
      `[DANFE_INTERPRETER] extração incompleta — mimeType=${mimeType} accessKey=${accessKey} number=${number} emitterCnpj=${emitterCnpj} textoNativo(${nativeText.length} chars)=${JSON.stringify(nativeText.slice(0, 1000))}`,
    );
  }

  return { accessKey, number, emitterCnpj };
}
