// Trim + uppercase pra comparação por palavra-chave entre textos livres
// (ex.: descrição de forma de pagamento da Bling vs. SKU/descrição de XML de
// NF-e) — nunca originou de um enum fechado dos dois lados, por isso a
// comparação é sempre por substring normalizada, não igualdade estrita.
export function normalizeMatchValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}
