import { InvoiceUnitBusinessAttributesStatus } from "../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";

type DecimalValue = string | number | null;

export interface ReportUnitBusiness {
  id: string;
  name: string | null;
  number: string | null;
}

/** raw + nest devolve o objeto com tudo null quando o LEFT JOIN não bate. */
type NullableUnitBusinessRow = { [K in keyof ReportUnitBusiness]: ReportUnitBusiness[K] | null } | null;

/** Escopo fixo do relatório + filtros próprios (fora do queryConfig de invoice). */
export interface SaleTransferInvoiceReportScope {
  unitBusinessId: string;
  type: string | string[];
  originUnitBusinessIds: string[];
  productIds: string[];
}

/** Linha crua do repository (raw + nest): nota de venda + pedido. */
export interface SaleTransferInvoiceRow {
  id: string;
  number_system: string | null;
  emitted_at: Date | null;
  transfer_invoice_number: string | null;
  transfer_invoice_emitted_at: Date | null;
  transfer_invoice_status: InvoiceUnitBusinessAttributesStatus | null;
  total_expected: DecimalValue;
  order: { number_order_system: string | null } | null;
  originUnitBusiness: NullableUnitBusinessRow;
  unitBusinessAttributes: {
    status: InvoiceUnitBusinessAttributesStatus | null;
    unitBusiness: NullableUnitBusinessRow;
  } | null;
}

export interface SaleTransferInvoiceReportRow {
  invoice_id: string;
  sale_invoice_number: string | null;
  sale_invoice_emitted_at: Date | null;
  /** Status da nota de venda na loja emitente (`invoice_unit_business_attributes.status`). */
  status: InvoiceUnitBusinessAttributesStatus | null;
  transfer_invoice_number: string | null;
  transfer_invoice_emitted_at: Date | null;
  /** Status da transferência na loja emitente dela (`invoice_unit_business_attributes.status`). */
  transfer_invoice_status: InvoiceUnitBusinessAttributesStatus | null;
  order_number: string | null;
  quantity: number;
  /** Loja da venda (origin unit business). */
  origin_unit_business: ReportUnitBusiness | null;
  /** Loja emitente da nota (unit business da invoice). */
  unit_business: ReportUnitBusiness | null;
}

export interface SaleTransferInvoiceReportSummary {
  invoices_count: number;
  with_transfer_count: number;
  total_quantity: number;
}

export interface SaleTransferInvoiceReport {
  data: SaleTransferInvoiceReportRow[];
  summary: SaleTransferInvoiceReportSummary;
}
