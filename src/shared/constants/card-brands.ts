// Bandeiras de cartão no código da NF-e (tBand) — padrão SEFAZ, é o que a Bling
// manda em dadosCartao.bandeira e o que order_payments.card_brand guarda.
// keywords: texto normalizado (maiúsculo, sem acento/espaço) lido no comprovante.
export const CARD_BRANDS: { code: number; name: string; keywords: string[] }[] = [
  { code: 1, name: "Visa", keywords: ["VISA"] },
  { code: 2, name: "Mastercard", keywords: ["MASTER"] },
  { code: 3, name: "American Express", keywords: ["AMEX", "AMERICANEXPRESS"] },
  { code: 4, name: "Sorocred", keywords: ["SOROCRED"] },
  { code: 5, name: "Diners Club", keywords: ["DINERS"] },
  { code: 6, name: "Elo", keywords: ["ELO"] },
  { code: 7, name: "Hipercard", keywords: ["HIPERCARD"] },
  { code: 8, name: "Aura", keywords: ["AURA"] },
  { code: 9, name: "Cabal", keywords: ["CABAL"] },
  { code: 99, name: "Outros", keywords: [] },
];
