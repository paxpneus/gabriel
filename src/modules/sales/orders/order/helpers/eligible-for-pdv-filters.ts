import { Sequelize } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import { UNASSIGNED_SELLER_NAME } from "../../../contacts/contacts.types";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../../company/unit-business/helpers/cd21-unit-business-number";

// Código Bling (actual_situation) de pedido cancelado. Elegibilidade pro
// PDV olha só esse código — qualquer outra situação (ex.: "21" em
// digitação) conta como aceito, independente de como internal_status
// mapeia aquele código.
export const BLING_CANCELLED_SITUACAO_ID = "12";

// Único critério de "cancelado" do PDV — 21/748772 também mapeiam pra
// internal_status CANCELLED, mas não derrubam a solicitação.
export const isPdvCancelledSituation = (situacaoId: string | number): boolean =>
  String(situacaoId) === BLING_CANCELLED_SITUACAO_ID;

// Pedido cujo invoice_id já tem romaneio gerado no CD21 (quem expede o PDV de toda loja, site Pax incluso) —
// mesma escopagem de pdv-sales-request.service.ts::isSaleInvoiceDeliveryNoteGenerated. Sem invoice_id segue elegível.
export function orderMissingGeneratedDeliveryNoteLiteral() {
  return Sequelize.literal(`NOT EXISTS (
    SELECT 1
    FROM expedition_batch_invoices ebi
    JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
    JOIN unit_businesses cd21 ON cd21.id = eb.unit_business_id
      AND cd21.number = ${sequelize.escape(CD21_UNIT_BUSINESS_NUMBER)}
    WHERE ebi.invoice_id = "Order"."invoice_id"
      AND eb.type = 'OUTGOING'
      AND eb.delivery_note_generated_at IS NOT NULL
  )`);
}

// Pedido da loja que exige vendedor (site Pax, loja online) só entra com vendedor válido — mesmo critério do
// relatório de vendedor (seller_id preenchido e ≠ "Vendedor 0"); pedido de outra loja não é afetado.
export function orderHasValidSellerWhenRequiredLiteral(
  sellerRequiredUnitBusinessId: string,
) {
  return Sequelize.literal(`(
    "Order"."unit_business_id" IS DISTINCT FROM ${sequelize.escape(sellerRequiredUnitBusinessId)}
    OR EXISTS (
      SELECT 1 FROM contacts seller
      WHERE seller.id = "Order"."seller_id"
        AND seller.name <> ${sequelize.escape(UNASSIGNED_SELLER_NAME)}
    )
  )`);
}

// Pedido da loja que exige vendedor (site Pax) só entra no PDV se foi feito à mão na Bling (numeroLoja vazio):
// pedido de integração (Magento etc.) já vem com pagamento validado, só falta gerar a nota — não passa por comprovante/Financeiro.
// Vazio/NULL/"undefined" (String(undefined) quando a Bling omite o campo) = sem integração.
export function orderWithoutIntegrationNumberWhenRequiredLiteral(
  sellerRequiredUnitBusinessId: string,
) {
  return Sequelize.literal(`(
    "Order"."unit_business_id" IS DISTINCT FROM ${sequelize.escape(sellerRequiredUnitBusinessId)}
    OR COALESCE(NULLIF(TRIM("Order"."number_order_channel"), ''), 'undefined') = 'undefined'
  )`);
}

// Literais de elegibilidade PDV além da situação (sem romaneio gerado + vendedor válido e sem número de integração
// quando a loja exige) — fonte única de orders.repository.ts::findEligibleForPdvByUnitBusiness/isEligibleForPdv.
export function pdvEligibilityLiterals(sellerRequiredUnitBusinessId: string | null) {
  const literals = [orderMissingGeneratedDeliveryNoteLiteral()];
  if (sellerRequiredUnitBusinessId) {
    literals.push(orderHasValidSellerWhenRequiredLiteral(sellerRequiredUnitBusinessId));
    literals.push(orderWithoutIntegrationNumberWhenRequiredLiteral(sellerRequiredUnitBusinessId));
  }
  return literals;
}
