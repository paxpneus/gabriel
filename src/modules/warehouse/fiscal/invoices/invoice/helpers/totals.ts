import { Sequelize } from "sequelize";

export function totalExpectedLiteral(tableAlias: string = "Invoice") {
  return Sequelize.literal(`(
      SELECT COALESCE(SUM(quantity_expected), 0)
      FROM invoice_items
      WHERE invoice_items.invoice_id = "${tableAlias}"."id"
    )`);
}

export function totalReadLiteral(unitBusinessId: string, tableAlias: string = "Invoice") {
  return Sequelize.literal(`(
    SELECT COALESCE(SUM(bii.quantity_read), 0)
    FROM expedition_batch_invoices ebi
    INNER JOIN batch_invoice_items bii ON bii.expedition_batch_invoice_id = ebi.id
    INNER JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
    WHERE ebi.invoice_id = "${tableAlias}"."id"
      AND eb.unit_business_id = '${unitBusinessId}'
  )`);
}