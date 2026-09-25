import { Sequelize } from "sequelize";

// Código Bling (actual_situation) de pedido cancelado. Elegibilidade pro
// PDV olha só esse código — qualquer outra situação (ex.: "21" em
// digitação) conta como aceito, independente de como internal_status
// mapeia aquele código.
export const BLING_CANCELLED_SITUACAO_ID = "12";

// Pedido cujo invoice_id já tem romaneio gerado (ExpeditionBatch com
// delivery_note_generated_at preenchido) NA LOJA DO PRÓPRIO PEDIDO — mesma
// cadeia Invoice → batchInvoice → batch de
// invoice.repository.ts#findDeliveryNoteGeneratedInvoiceIds, mas escopada
// dinamicamente pelo unit_business de CADA pedido (não uma loja fixa como
// CD21), por isso via subquery correlacionada em vez de include — o
// unit_business_id que importa aqui varia por linha, o que um JOIN de
// associação normal não expressa. invoice_unit_business_attributes.
// batch_generated confirma que o romaneio é da própria loja do pedido, não
// de outra loja que também recebeu essa nota. Pedido sem invoice_id ainda
// nunca casa (NOT EXISTS com invoice_id NULL nunca é verdadeiro) — segue
// elegível.
export function orderMissingGeneratedDeliveryNoteLiteral() {
  return Sequelize.literal(`NOT EXISTS (
    SELECT 1
    FROM invoice_unit_business_attributes iuba
    JOIN expedition_batch_invoices ebi ON ebi.invoice_id = iuba.invoice_id
    JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
      AND eb.unit_business_id = iuba.unit_business_id
    WHERE iuba.invoice_id = "Order"."invoice_id"
      AND iuba.unit_business_id = "Order"."unit_business_id"
      AND iuba.batch_generated = true
      AND eb.delivery_note_generated_at IS NOT NULL
  )`);
}
