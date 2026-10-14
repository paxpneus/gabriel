import { FindAttributeOptions, Sequelize } from "sequelize";
import { totalExpectedLiteral } from "../../../../warehouse/fiscal/invoices/invoice/helpers/totals";

export const SALE_INVOICE_ALIAS = "Invoice";

// Vínculo venda→transferência vive em pdv_sales_requests (só fluxo PDV); a solicitação mais recente com transferência vence.
export function transferInvoiceColumnLiteral(
  column: "number_system" | "emitted_at",
  saleInvoiceAlias: string = SALE_INVOICE_ALIAS,
) {
  return Sequelize.literal(`(
    SELECT ti.${column}
    FROM pdv_sales_requests psr
    JOIN invoices ti ON ti.id = psr.transfer_invoice_id
    WHERE psr.sale_invoice_id = "${saleInvoiceAlias}"."id"
    ORDER BY psr.created_at DESC
    LIMIT 1
  )`);
}

// Status da transferência na loja emitente dela (cnpj = sender_cnpj), não na loja do escopo da venda.
export function transferInvoiceStatusLiteral(
  saleInvoiceAlias: string = SALE_INVOICE_ALIAS,
) {
  return Sequelize.literal(`(
    SELECT a.status
    FROM pdv_sales_requests psr
    JOIN invoices ti ON ti.id = psr.transfer_invoice_id
    JOIN unit_businesses ub ON ub.cnpj = ti.sender_cnpj
    JOIN invoice_unit_business_attributes a
      ON a.invoice_id = ti.id AND a.unit_business_id = ub.id
    WHERE psr.sale_invoice_id = "${saleInvoiceAlias}"."id"
    ORDER BY psr.created_at DESC
    LIMIT 1
  )`);
}

// total_expected é VIRTUAL no model (sumiria do SELECT); calcula pelos invoice_items.
export function saleInvoiceRowAttributes(
  saleInvoiceAlias: string = SALE_INVOICE_ALIAS,
): FindAttributeOptions {
  return [
    "id",
    "number_system",
    "emitted_at",
    [transferInvoiceColumnLiteral("number_system", saleInvoiceAlias), "transfer_invoice_number"],
    [transferInvoiceColumnLiteral("emitted_at", saleInvoiceAlias), "transfer_invoice_emitted_at"],
    [transferInvoiceStatusLiteral(saleInvoiceAlias), "transfer_invoice_status"],
    [totalExpectedLiteral(saleInvoiceAlias), "total_expected"],
  ];
}

// Status da nota na loja do escopo (invoice_unit_business_attributes).
export const INVOICE_ATTRIBUTES_ROW_ATTRIBUTES = ["status"];
export const ORDER_ROW_ATTRIBUTES = ["number_order_system"];
export const UNIT_BUSINESS_ROW_ATTRIBUTES = ["id", "name", "number"];
