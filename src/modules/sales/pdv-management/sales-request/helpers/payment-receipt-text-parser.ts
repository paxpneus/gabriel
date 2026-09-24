import {
  EMPTY_PAYMENT_RECEIPT_EXTRACTION,
  PaymentReceiptExtraction,
} from "../pdv-sales-request.types";

// Bancos/maquininhas mais comuns nos comprovantes do PDV — lista fechada de
// propósito (mesmo espírito de "nunca inventar valor" do prompt de IA
// antigo): se o texto não citar um nome conhecido, fica null em vez de
// arriscar um trecho de texto qualquer.
const KNOWN_PAYMENT_INSTITUTIONS = [
  "Itaú",
  "Bradesco",
  "Santander",
  "Banco do Brasil",
  "Caixa",
  "Nubank",
  "Inter",
  "Sicoob",
  "Sicredi",
  "PagSeguro",
  "PagBank",
  "Cielo",
  "Stone",
  "Rede",
  "GetNet",
  "SumUp",
  "Mercado Pago",
  "InfinitePay",
  "Ton",
];

const KNOWN_CARD_BRANDS = [
  "Visa",
  "Mastercard",
  "Master Card",
  "Elo",
  "American Express",
  "Amex",
  "Hipercard",
  "Diners Club",
  "Diners",
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// "1.234,56" / "34,33" → 1234.56 / 34.33 (formato brasileiro, vírgula
// decimal). Não tenta suportar formato americano — comprovante nacional.
function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function findFirst(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function findKnownTerm(text: string, terms: string[]): string | null {
  const normalized = normalize(text);
  for (const term of terms) {
    if (normalized.includes(normalize(term))) return term;
  }
  return null;
}

function detectTipoComprovante(
  normalized: string,
): PaymentReceiptExtraction["tipo_comprovante"] {
  if (/\bpix\b/.test(normalized)) return "pix";
  if (/d[ée]bito/.test(normalized)) return "cartao_debito";
  if (/cr[ée]dito/.test(normalized)) return "cartao_credito";
  if (/transfer[êe]ncia|\bted\b|\bdoc\b/.test(normalized)) {
    return "transferencia";
  }
  return null;
}

function detectValorTotal(text: string): number | null {
  const totalLineMatch = text.match(
    /(?:valor\s+total|total)\D{0,10}R\$\s*([\d.,]+)/i,
  );
  if (totalLineMatch) return parseMoney(totalLineMatch[1]);

  const anyValue = findFirst(text, /R\$\s*([\d.,]+)/i);
  return anyValue ? parseMoney(anyValue) : null;
}

function detectParcelas(
  text: string,
): { qtd: number | null; valor: number | null } {
  const match = text.match(/(\d{1,2})\s*x\s*(?:de)?\s*R\$\s*([\d.,]+)/i);
  if (match) {
    return { qtd: Number(match[1]), valor: parseMoney(match[2]) };
  }

  const qtdOnly = text.match(/parcelas?\D{0,5}?(\d{1,2})/i);
  return { qtd: qtdOnly ? Number(qtdOnly[1]) : null, valor: null };
}

function detectCartaoFinal(text: string): string | null {
  const match = text.match(
    /(?:final(?:is)?)\s*[:\-]?\s*(\d{4})|\*{2,}\s?(\d{4})/i,
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function detectCodigoAutorizacao(text: string): string | null {
  return findFirst(
    text,
    /(?:autoriza[cç][aã]o|cod\.?\s*aut(?:oriza[cç][aã]o)?)\D{0,6}?([A-Z0-9]{4,10})/i,
  );
}

function detectNsuCv(text: string): string | null {
  return findFirst(text, /\b(?:nsu|cv)\D{0,5}?(\d{4,12})/i);
}

function detectTitular(text: string): string | null {
  return findFirst(
    text,
    /(?:titular|portador)\D{0,5}?([A-ZÀ-Ú][A-ZÀ-Ú\s]{4,40})/,
  )?.trim() ?? null;
}

function detectEstabelecimentoNome(text: string): string | null {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length >= 3 &&
        !/^\d+$/.test(line) &&
        !/^(comprovante|recibo|extrato)/i.test(line),
    );
  return firstLine ?? null;
}

// Substitui o prompt de IA (Gemini) por regex/heurísticas locais sobre o
// texto já extraído (pdf-parse ou OCR, ver receipt-text-extraction.ts) —
// decisão consciente de abrir mão de flexibilidade em favor de zero
// dependência de IA/rede nesse fluxo. Formatos de comprovante muito fora do
// padrão (layouts atípicos de banco/maquininha) tendem a deixar mais campos
// null do que a extração por IA deixava — aceitável porque a análise nunca
// bloqueia o fluxo (financeiro/CD21 sempre revisam manualmente).
export function parsePaymentReceiptText(
  text: string,
): PaymentReceiptExtraction {
  if (!text.trim()) return { ...EMPTY_PAYMENT_RECEIPT_EXTRACTION };

  const normalized = normalize(text);
  const { qtd, valor } = detectParcelas(text);

  return {
    tipo_comprovante: detectTipoComprovante(normalized),
    estabelecimento_nome: detectEstabelecimentoNome(text),
    estabelecimento_cnpj: findFirst(
      text,
      /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/,
    ),
    valor_total: detectValorTotal(text),
    qtd_parcelas: qtd,
    valor_parcela: valor,
    data_transacao: findFirst(text, /(\d{2}\/\d{2}\/\d{4})/),
    hora_transacao: findFirst(text, /(\d{2}:\d{2}(?::\d{2})?)/),
    bandeira_cartao: findKnownTerm(text, KNOWN_CARD_BRANDS),
    instituicao_pagamento: findKnownTerm(text, KNOWN_PAYMENT_INSTITUTIONS),
    titular_cartao: detectTitular(text),
    cartao_final: detectCartaoFinal(text),
    codigo_autorizacao: detectCodigoAutorizacao(text),
    nsu_cv: detectNsuCv(text),
  };
}
