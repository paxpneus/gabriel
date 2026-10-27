import sequelize from "../../../../../config/sequelize";

/** LATERAL join with the affiliate (contact_id) and the frozen commission of an order; no `active` filter, reports show who earned it at the time. */
export function orderAffiliateJoinSql(orderAlias: string, alias: string): string {
  const quote = (name: string) => sequelize.getQueryInterface().quoteIdentifier(name);
  return `LEFT JOIN LATERAL (
    SELECT cc.contact_id, oc.commission_amount
    FROM order_coupons oc
    JOIN contact_coupons cc ON cc.id = oc.contact_coupon_id
    WHERE oc.order_id = ${quote(orderAlias)}.id
  ) ${quote(alias)} ON TRUE`;
}
