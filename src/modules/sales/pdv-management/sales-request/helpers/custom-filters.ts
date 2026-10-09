import { Op, Sequelize, WhereOptions } from "sequelize";
import { isUuid, transporterSelectorSql } from "./transporter-cd";
import { PdvBatchStage, PdvTransporterSelector } from "../pdv-sales-request.types";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../../company/unit-business/helpers/cd21-unit-business-number";

// Filtro por order.number_order_system na listagem de PdvSalesRequest —
// EXISTS correlacionado (nunca "$order.field$"): não depende de nenhum
// include estar presente, então vale igual pro quadro e pras contagens
// agrupadas (countGroupedByStatus, sem join).
export function orderNumberSystemMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND o.number_order_system ILIKE '%${escaped}%'
  )`);
}

// Filtro por nome do cliente do pedido vinculado — mesmo EXISTS
// correlacionado de orderNumberSystemMatchesLiteral (mesmo motivo).
export function orderCustomerNameMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND c.name ILIKE '%${escaped}%'
  )`);
}

// Busca livre da listagem (`search`) — combina number_order_system e
// nome/documento do cliente do pedido vinculado, e number_system da nota
// de venda OU de transferência (as duas são FK própria de PdvSalesRequest,
// sem precisar passar por order) num único OR. Usada só por `search`,
// nunca por `filters[...]` — ver PdvSalesRequestService.buildBoardBaseWhere:
// o `search` genérico do QueryParser não serve aqui, já que `searchFields`
// fica vazio pra essa entidade e zeraria o resultado (`where.id = null`).
export function pdvSalesRequestSearchLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  const like = `'%${escaped}%'`;

  return Sequelize.literal(`(
    EXISTS (
      SELECT 1 FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = "PdvSalesRequest"."order_id"
        AND (
          o.number_order_system ILIKE ${like}
          OR c.name ILIKE ${like}
          OR c.document ILIKE ${like}
        )
    )
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id IN ("PdvSalesRequest"."sale_invoice_id", "PdvSalesRequest"."transfer_invoice_id")
        AND i.number_system ILIKE ${like}
    )
  )`);
}

// Filtro por período de order.date — mesmo EXISTS correlacionado acima.
// start/end validados como YYYY-MM-DD antes de entrar no literal (nunca
// interpolar direto o que vier de fora sem validar formato).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function orderDateWithinLiteral(range: {
  start?: string;
  end?: string;
}) {
  const conditions: string[] = [];

  if (range.start && DATE_ONLY.test(range.start)) {
    conditions.push(`o.date >= '${range.start}'::date`);
  }
  if (range.end && DATE_ONLY.test(range.end)) {
    conditions.push(`o.date < ('${range.end}'::date + INTERVAL '1 day')`);
  }

  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = "PdvSalesRequest"."order_id"
      ${conditions.map((c) => `AND ${c}`).join(" ")}
  )`);
}

// Filtro por reason dentro de PdvSalesRequest.errors (JSONB { reasons:
// string[] }) — operador jsonb "?|" testa se QUALQUER elemento do array
// bate com algum dos reasons pedidos, sem precisar decodificar o JSON em
// aplicação.
export function errorsReasonsOverlapLiteral(reasons: string[]) {
  const values = reasons
    .map((reason) => `'${reason.replace(/'/g, "''")}'`)
    .join(",");

  return Sequelize.literal(
    `("PdvSalesRequest"."errors" -> 'reasons') ?| array[${values}]`,
  );
}

// Card do quadro só precisa saber se há comprovante (next_action) — EXISTS
// em vez de include hasMany (servido por idx_pdv_sales_request_receipts_request_id).
export function hasReceiptLiteral() {
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM pdv_sales_request_receipts r
    WHERE r.pdv_sales_request_id = "PdvSalesRequest"."id"
  )`);
}

// Filtro por transportadora da nota de venda — ids validados como uuid antes de entrar no literal.
export function saleInvoiceTransporterInLiteral(transporterIds: string[]) {
  const ids = transporterIds.map((id) => id.trim()).filter(isUuid);
  if (!ids.length) return Sequelize.literal("FALSE");

  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = "PdvSalesRequest"."sale_invoice_id"
      AND i.transporter_id IN (${ids.map((id) => `'${id}'`).join(",")})
  )`);
}

// Nota de venda da transportadora do seletor (CD pelo nome, ou id).
export function saleInvoiceTransporterSelectorLiteral(
  selector: PdvTransporterSelector,
) {
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = "PdvSalesRequest"."sale_invoice_id"
      AND ${transporterSelectorSql(selector, { name: "i.transporter_name", id: "i.transporter_id" })}
  )`);
}

// Estágio da nota de venda no lote do CD21 — mesmo vínculo de batchInvoicesService.findBatchIdsByInvoiceIds.
function saleInvoiceCd21BatchStageSql(stage: PdvBatchStage): string {
  const inCd21Batch = (batchCondition = "") => `EXISTS (
    SELECT 1 FROM expedition_batch_invoices bi
    JOIN expedition_batches b ON b.id = bi.expedition_batch_id
    JOIN unit_businesses ub ON ub.id = b.unit_business_id
    WHERE bi.invoice_id = "PdvSalesRequest"."sale_invoice_id"
      AND ub.number = '${CD21_UNIT_BUSINESS_NUMBER}'
      ${batchCondition}
  )`;

  const sql: Record<PdvBatchStage, string> = {
    [PdvBatchStage.WITHOUT_BATCH]: `("PdvSalesRequest"."sale_invoice_id" IS NOT NULL AND NOT ${inCd21Batch()})`,
    [PdvBatchStage.IN_BATCH]: inCd21Batch(),
    [PdvBatchStage.OPEN_BATCH]: inCd21Batch(`AND b.status IN ('OPEN', 'PENDING')`),
    [PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE]: inCd21Batch(
      `AND b.status = 'FINISHED' AND b.delivery_note_generated_at IS NULL`,
    ),
  };
  return sql[stage];
}

export function saleInvoiceCd21BatchStageLiteral(stage: PdvBatchStage) {
  return Sequelize.literal(saleInvoiceCd21BatchStageSql(stage));
}

// Estágio do card (cor no quadro) — mesmo SQL dos filtros; aberto vence finalizado se a nota estiver nos dois.
const CARD_BATCH_STAGES = [
  PdvBatchStage.WITHOUT_BATCH,
  PdvBatchStage.OPEN_BATCH,
  PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE,
] as const;

export function saleInvoiceCd21BatchStageCaseLiteral() {
  const whens = CARD_BATCH_STAGES.map(
    (stage) => `WHEN ${saleInvoiceCd21BatchStageSql(stage)} THEN '${stage}'`,
  ).join(" ");
  return Sequelize.literal(`(CASE ${whens} ELSE NULL END)`);
}

// filters[without_batch|open_batch|pending_delivery_note]=true: só o estágio; transportadora é filters[transporter_id], opcional.
export function batchStageFlagWhere(
  value: string | string[],
  stage: PdvBatchStage,
): WhereOptions {
  const raw = String(Array.isArray(value) ? value[0] : value).toLowerCase();
  if (raw !== "true" && raw !== "1") return {};
  return { [Op.and]: [saleInvoiceCd21BatchStageLiteral(stage)] };
}

// filters[adt_*]: mesmo filtro pela transportadora própria CD 12/17 (outro CD → nada).
export function adtBatchStageWhere(
  value: string | string[],
  stage: PdvBatchStage,
): WhereOptions {
  const cd = String(Array.isArray(value) ? value[0] : value).replace(/\D/g, "");
  return {
    [Op.and]: [
      saleInvoiceTransporterSelectorLiteral({ cd }),
      saleInvoiceCd21BatchStageLiteral(stage),
    ],
  };
}
