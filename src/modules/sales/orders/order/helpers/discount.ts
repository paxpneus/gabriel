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
