import { divScaled, formatScaled, mulScaled, toScaled } from "../decimal";

export type BlingPriceParseResult =
  | { status: "ok"; value: string }
  | { status: "missing" }
  | { status: "zero" }
  | { status: "invalid" };

/** `preco` da Bling (10 casas) -> decimal(4); ausente/zero/inválido nunca vira 0, quem chama grava NULL e loga. */
export function parseBlingEntryPrice(
  raw: string | number | null | undefined,
): BlingPriceParseResult {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { status: "missing" };
  }

  const scaled = toScaled(raw);
  if (scaled === null) return { status: "invalid" };
  if (scaled <= 0n) return { status: "zero" };

  return { status: "ok", value: formatScaled(scaled) };
}

/** Atalho: decimal(4) ou null, sem log. */
export function blingEntryPriceOrNull(
  raw: string | number | null | undefined,
): string | null {
  const result = parseBlingEntryPrice(raw);
  return result.status === "ok" ? result.value : null;
}

/** Preço médio ponderado pela quantidade (BigInt); linhas sem preço ficam fora, sem nenhuma retorna null. */
export function weightedAveragePrice(
  items: { quantity: string | number; price: string | null }[],
): string | null {
  let totalValue = 0n;
  let totalQuantity = 0n;

  for (const item of items) {
    const price = toScaled(item.price);
    const quantity = toScaled(item.quantity);
    if (price === null || quantity === null || quantity <= 0n) continue;
    totalValue += mulScaled(price, quantity);
    totalQuantity += quantity;
  }

  if (totalQuantity === 0n) return null;
  return formatScaled(divScaled(totalValue, totalQuantity));
}
