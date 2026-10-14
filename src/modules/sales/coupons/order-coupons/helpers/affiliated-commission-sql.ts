// Afiliado do pedido (no máximo 1, índice parcial) com a comissão congelada; sem filtro de `active`,
// relatório mostra quem recebeu na época. Expõe `<alias>.contact_id` e `<alias>.commission_amount`.
export function orderAffiliateJoinSql(orderAlias: string, alias: string): string {
  return `LEFT JOIN LATERAL (
    SELECT cc.contact_id, oc.commission_amount
    FROM order_coupons oc
    JOIN contact_coupons cc ON cc.id = oc.contact_coupon_id
    WHERE oc.order_id = ${orderAlias}.id
  ) ${alias} ON TRUE`;
}
