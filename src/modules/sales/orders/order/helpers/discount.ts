// `orders.discount_type` vem do `desconto.unidade` do Bling; o resto ("REAL") é valor em reais.
export const ORDER_DISCOUNT_TYPE_PERCENT = "PERCENTUAL";

// Desconto do pedido em reais (Bling manda `desconto.valor` como % de totalProdutos ou em R$).
export function orderDiscountAmountSql(orderAlias: string): string {
  return `CASE
    WHEN ${orderAlias}.discount_type = '${ORDER_DISCOUNT_TYPE_PERCENT}'
      THEN ROUND(COALESCE(${orderAlias}.total_products, 0) * COALESCE(${orderAlias}.discount_value, 0) / 100, 2)
    ELSE COALESCE(${orderAlias}.discount_value, 0)
  END`;
}

// Preço de venda dos produtos após o desconto do pedido (sem frete/outras despesas) — base de comissão.
export function orderNetProductsSql(orderAlias: string): string {
  return `(COALESCE(${orderAlias}.total_products, 0) - ${orderDiscountAmountSql(orderAlias)})`;
}

/** Mesma conta de orderNetProductsSql, em TS — base de comissão a partir do pedido já gravado. */
export function orderNetProductsAmount(order: {
  total_products?: number | string | null;
  discount_value?: number | string | null;
  discount_type?: string | null;
}): number {
  const totalProducts = Number(order.total_products ?? 0);
  const discount = Number(order.discount_value ?? 0);
  const discountAmount =
    order.discount_type === ORDER_DISCOUNT_TYPE_PERCENT
      ? Math.round(totalProducts * discount) / 100
      : discount;
  return totalProducts - discountAmount;
}
