import { SELLER_MANAGER_CONTACT_TYPE } from "../../contacts.types";

// Período (`period`) do gerente cobrindo a data do pedido; períodos de um gerente não se sobrepõem (sellerService), então casa no máximo um.
function managerPeriodsFromSql(orderDateSql: string): string {
  return `
    FROM contacts manager
    CROSS JOIN LATERAL jsonb_array_elements(manager.custom_data->'manager_periods') period
    WHERE manager.type = '${SELLER_MANAGER_CONTACT_TYPE}'
      AND CAST(period->>'start_date' AS date) <= ${orderDateSql}
      AND COALESCE(CAST(period->>'end_date' AS date), ${orderDateSql}) >= ${orderDateSql}`;
}

/** FROM/WHERE dos gerentes da loja (`manager`): SELLER_MANAGER com período dessa loja cobrindo a data do pedido. Usar com SELECT ou EXISTS. */
export function storeManagersFromSql(unitBusinessIdSql: string, orderDateSql: string): string {
  return `${managerPeriodsFromSql(orderDateSql)}
      AND CAST(period->>'unit_business_id' AS uuid) = ${unitBusinessIdSql}`;
}

/** FROM/WHERE dos regionais da loja (`manager`): período com grupo que tem a loja na data do pedido, menos quando o mesmo período já é dessa loja (ganha uma vez só). */
export function regionalManagersFromSql(unitBusinessIdSql: string, orderDateSql: string): string {
  return `${managerPeriodsFromSql(orderDateSql)}
      AND CAST(period->>'unit_business_id' AS uuid) IS DISTINCT FROM ${unitBusinessIdSql}
      AND EXISTS (
        SELECT 1 FROM unit_business_group_members member
        WHERE member.unit_business_group_id = CAST(period->>'unit_business_group_id' AS uuid)
          AND member.unit_business_id = ${unitBusinessIdSql}
      )`;
}
