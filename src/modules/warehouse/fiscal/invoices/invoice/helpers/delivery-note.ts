import { Op, Sequelize, WhereOptions } from "sequelize";

// Nota de transferência: sender_cnpj/receiver_cnpj batem com unit_businesses
// dos dois lados — "romaneio gerado" é true se o batch de QUALQUER uma das
// duas pontas (remetente OU destinatária) já teve delivery note emitido.
// Mesma EXISTS reaproveitada pro atributo calculado (SELECT) e pro filtro
// (WHERE), pra não duplicar o SQL.
function deliveryNoteGeneratedExistsSql(tableAlias: string = "Invoice"): string {
  return `EXISTS (
    SELECT 1
    FROM expedition_batch_invoices ebi
    JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
    JOIN unit_businesses ub ON ub.id = eb.unit_business_id
    WHERE ebi.invoice_id = "${tableAlias}"."id"
      AND eb.delivery_note_generated_at IS NOT NULL
      AND ub.cnpj IN ("${tableAlias}"."sender_cnpj", "${tableAlias}"."receiver_cnpj")
  )`;
}

export function deliveryNoteGeneratedLiteral(tableAlias: string = "Invoice") {
  return Sequelize.literal(deliveryNoteGeneratedExistsSql(tableAlias));
}

export function deliveryNoteGeneratedWhere(generated: boolean): WhereOptions {
  const exists = deliveryNoteGeneratedExistsSql();
  return {
    [Op.and]: [Sequelize.literal(generated ? exists : `NOT ${exists}`)],
  };
}
