import { INVOICED_STATUSES } from "../../../reports/sales-invoiced-report/repositories/query-objects/sales-invoiced-report.filters";
import { invoiceCancelledSql } from "../../../warehouse/fiscal/invoices/invoice";

// Data que decide se um item de snapshot cai na vigência da regra: vale a emissão da nota do pedido
// (pedido dia 31, nota dia 01 → conta dia 01). Só tem data (= é elegível) pedido com nota não cancelada
// e status Atendido/Enviado/Entregue; senão NULL, nenhuma regra casa e o desconto zera.

/** JOINs que trazem pedido, nota e status normalizado do snapshot `snapshotAlias` (usar junto com `supplierDiscountReferenceDateSql`). */
export function supplierDiscountReferenceDateJoinSql(snapshotAlias: string): string {
  return `
    LEFT JOIN orders sd_ref_o ON sd_ref_o.id = ${snapshotAlias}.order_id
    LEFT JOIN invoices sd_ref_inv ON sd_ref_inv.id = sd_ref_o.invoice_id
    LEFT JOIN integration_order_status_mappings sd_ref_iosm
      ON sd_ref_iosm.integration_id = sd_ref_o.integrations_id
      AND sd_ref_iosm.external_status_id = sd_ref_o.actual_situation`;
}

/** Emissão da nota (nota sem `emitted_at` cai pro dia do pedido, meia-noite de Brasília); NULL se o pedido não é elegível. */
export function supplierDiscountReferenceDateSql(snapshotAlias: string): string {
  const statuses = INVOICED_STATUSES.map((status) => `'${status}'`).join(", ");
  return `(CASE
    WHEN sd_ref_inv.id IS NOT NULL
      AND NOT ${invoiceCancelledSql("sd_ref_inv.id")}
      AND COALESCE(sd_ref_iosm.normalized_status, sd_ref_o.actual_situation) IN (${statuses})
    THEN COALESCE(sd_ref_inv.emitted_at, (${snapshotAlias}.order_date::timestamp AT TIME ZONE 'America/Sao_Paulo'))
  END)`;
}
