import { Sequelize } from "sequelize";
import sequelize from "../../../../../../../config/sequelize";

export function totalExpectedLiteral(tableAlias: string = "Invoice") {
  const t = sequelize.getQueryInterface().quoteIdentifier(tableAlias);
  return Sequelize.literal(`(
      SELECT COALESCE(SUM(quantity_expected), 0)
      FROM invoice_items
      WHERE invoice_items.invoice_id = ${t}."id"
    )`);
}

// unitBusinessId escapado (pode vir do request); alias via quoteIdentifier. batchType: transbordo tem lote de entrada e de expedição da mesma nota.
export function totalReadLiteral(
  unitBusinessId?: string,
  tableAlias: string = "Invoice",
  batchType?: "INCOMING" | "OUTGOING",
) {
  const t = sequelize.getQueryInterface().quoteIdentifier(tableAlias);
  return Sequelize.literal(`(
    SELECT COALESCE(SUM(bii.quantity_read), 0)
    FROM expedition_batch_invoices ebi
    INNER JOIN batch_invoice_items bii ON bii.expedition_batch_invoice_id = ebi.id
    INNER JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
    WHERE ebi.invoice_id = ${t}."id"
      ${unitBusinessId ? `AND eb.unit_business_id = ${sequelize.escape(unitBusinessId)}` : ""}
      ${batchType === "INCOMING" || batchType === "OUTGOING" ? `AND eb.type = '${batchType}'` : ""}
  )`);
}