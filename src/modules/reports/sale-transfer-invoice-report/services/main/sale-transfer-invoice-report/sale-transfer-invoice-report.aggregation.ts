import {
  formatScaled,
  toScaled,
} from "../../../../../../shared/utils/normalizers/decimal";
import {
  ReportUnitBusiness,
  SaleTransferInvoiceReportRow,
  SaleTransferInvoiceReportSummary,
  SaleTransferInvoiceRow,
} from "../../../models/sale-transfer-invoice-report.types";

function toUnitBusiness(
  row: SaleTransferInvoiceRow["originUnitBusiness"],
): ReportUnitBusiness | null {
  return row?.id ? { id: row.id, name: row.name, number: row.number } : null;
}

export function buildReportRows(
  rows: SaleTransferInvoiceRow[],
): SaleTransferInvoiceReportRow[] {
  return rows.map((row) => ({
    invoice_id: row.id,
    sale_invoice_number: row.number_system,
    sale_invoice_emitted_at: row.emitted_at,
    status: row.unitBusinessAttributes?.status ?? null,
    transfer_invoice_number: row.transfer_invoice_number,
    transfer_invoice_emitted_at: row.transfer_invoice_emitted_at,
    transfer_invoice_status: row.transfer_invoice_status,
    order_number: row.order?.number_order_system ?? null,
    quantity: Number(row.total_expected ?? 0),
    origin_unit_business: toUnitBusiness(row.originUnitBusiness),
    unit_business: toUnitBusiness(row.unitBusinessAttributes?.unitBusiness ?? null),
  }));
}

export function buildSummary(
  rows: SaleTransferInvoiceReportRow[],
): SaleTransferInvoiceReportSummary {
  let totalQuantity = 0n;
  for (const row of rows) totalQuantity += toScaled(row.quantity) ?? 0n;

  return {
    invoices_count: rows.length,
    with_transfer_count: rows.filter((row) => row.transfer_invoice_number).length,
    total_quantity: Number(formatScaled(totalQuantity)),
  };
}
