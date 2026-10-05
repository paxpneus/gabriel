import {
  countInstallments,
  toPaymentsView,
} from "../../../orders/order_payment/helpers/payments-view";
import { PdvBoardScreen } from "../../helpers/pdv-screens.config";
import {
  PdvBoardCard,
  PdvReceiptAnalysisField,
  PdvReceiptAnalysisView,
  PdvSalesRequestDetail,
} from "../pdv-sales-request.types";
import { getNextAction } from "./next-action.rules";
import { buildShippingLabel } from "./shipping-label";

const RECEIPT_ANALYSIS_FIELDS: readonly PdvReceiptAnalysisField[] = [
  "tipo_comprovante",
  "valor_total",
  "qtd_parcelas",
  "valor_parcela",
  "data_transacao",
  "hora_transacao",
  "instituicao_pagamento",
  "titular_cartao",
  "bandeira_cartao",
  "codigo_autorizacao",
  "nsu_cv",
];

// Loja do pedido só aparece no card de quem enxerga todas as lojas.
const SCREENS_WITH_CARD_UNIT_BUSINESS: readonly PdvBoardScreen[] = [
  "finance",
  "cd21",
  "telesales",
];

// Serve tanto a análise conciliada (payment_methods) quanto a de um comprovante (payment_method).
export function pickReceiptAnalysisFields(
  analysis: Record<string, any> | null | undefined,
): PdvReceiptAnalysisView | null {
  if (!analysis) return null;

  const picked = Object.fromEntries(
    RECEIPT_ANALYSIS_FIELDS.map((field) => [field, analysis[field] ?? null]),
  ) as PdvReceiptAnalysisView;
  if ("payment_methods" in analysis) {
    picked.payment_methods = analysis.payment_methods ?? [];
  }
  if ("payment_method" in analysis) {
    picked.payment_method = analysis.payment_method ?? null;
  }
  return picked;
}

// `row` = linha plana de PdvSalesRequestRepository.findBoardColumnPage.
export function toBoardCard(row: any, screen: PdvBoardScreen): PdvBoardCard {
  const order = row.order;

  return {
    id: row.id,
    status: row.status,
    shipping_label: buildShippingLabel(
      row.shipping_type,
      row.saleInvoice?.transporter_name,
    ),
    next_action: getNextAction(
      {
        status: row.status,
        shipping_type: row.shipping_type ?? null,
        correction_origin_status: row.correction_origin_status ?? null,
        has_receipt: !!row.has_receipt,
      },
      screen,
    ),
    order: order
      ? {
          id: order.id,
          number_order_system: order.number_order_system ?? null,
          number_order_channel: order.number_order_channel,
          date: order.date ?? null,
          customer: order.customer ? { name: order.customer.name } : null,
          ...(SCREENS_WITH_CARD_UNIT_BUSINESS.includes(screen) && {
            unitBusiness: order.unitBusiness
              ? { number: order.unitBusiness.number }
              : null,
          }),
        }
      : null,
    saleInvoice: row.saleInvoice
      ? { tracking_url: row.saleInvoice.tracking_url ?? null }
      : null,
  };
}

export interface PdvSalesRequestDetailExtras {
  orderStatus: string | null;
  expeditionProgress: unknown;
  shippingInfoRequired: boolean;
}

// `plain` = PdvSalesRequestRepository.findByIdWithOrder em formato plano.
export function toSalesRequestDetail(
  plain: any,
  screen: PdvBoardScreen,
  extras: PdvSalesRequestDetailExtras,
): PdvSalesRequestDetail {
  const receipts: any[] = plain.receipts ?? [];
  const order = plain.order;

  return {
    id: plain.id,
    status: plain.status,
    next_action: getNextAction(
      {
        status: plain.status,
        shipping_type: plain.shipping_type ?? null,
        correction_origin_status: plain.correction_origin_status ?? null,
        has_receipt: receipts.length > 0,
      },
      screen,
    ),
    shipping_info_required: extras.shippingInfoRequired,
    correction_origin_status: plain.correction_origin_status ?? null,
    // errors.origin repete correction_origin_status — sai.
    errors: plain.errors
      ? {
          reasons: plain.errors.reasons ?? [],
          note: plain.errors.note ?? null,
        }
      : null,
    origin: plain.origin ?? null,
    shipping_type: plain.shipping_type ?? null,
    shipping_label: buildShippingLabel(
      plain.shipping_type,
      plain.saleInvoice?.transporter_name,
    ),
    shipping_address: plain.shipping_address ?? null,
    transporter_name: plain.transporter_name ?? null,
    sale_invoice_id: plain.sale_invoice_id ?? null,
    transfer_invoice_id: plain.transfer_invoice_id ?? null,
    payment_receipt_analysis: pickReceiptAnalysisFields(
      plain.payment_receipt_analysis,
    ),
    payment_receipt_validated: plain.payment_receipt_validated ?? null,
    payment_method_matches_receipt: plain.payment_method_matches_receipt ?? null,
    receipt_total_matches_order: plain.receipt_total_matches_order ?? null,
    receipt_total_difference: plain.receipt_total_difference ?? null,
    transfer_invoice_products_match_sale:
      plain.transfer_invoice_products_match_sale ?? null,
    expedition_progress: extras.expeditionProgress,
    saleInvoice: plain.saleInvoice
      ? {
          id: plain.saleInvoice.id,
          number_system: plain.saleInvoice.number_system,
          transporter_name: plain.saleInvoice.transporter_name ?? null,
          tracking_url: plain.saleInvoice.tracking_url ?? null,
        }
      : null,
    transferInvoice: plain.transferInvoice
      ? {
          id: plain.transferInvoice.id,
          number_system: plain.transferInvoice.number_system,
        }
      : null,
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      analysis: pickReceiptAnalysisFields(receipt.analysis),
    })),
    order: order
      ? {
          number_order_system: order.number_order_system ?? null,
          number_order_channel: order.number_order_channel,
          date: order.date ?? null,
          net_total_order: order.net_total_order ?? null,
          status: extras.orderStatus,
          installments: countInstallments(order.source_payload),
          customer: order.customer
            ? { name: order.customer.name, document: order.customer.document }
            : null,
          unitBusiness: order.unitBusiness
            ? { number: order.unitBusiness.number, name: order.unitBusiness.name }
            : null,
          payments: toPaymentsView(order.payments),
          items: (order.items ?? []).map((item: any) => ({
            id: item.id,
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            price: item.price,
          })),
        }
      : null,
  };
}
