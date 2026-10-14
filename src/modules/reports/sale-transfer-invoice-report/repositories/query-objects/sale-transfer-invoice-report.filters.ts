import { Op, WhereOptions } from "sequelize";
import {
  invoiceOriginUnitBusinessWhere,
  invoiceProductWhere,
} from "../../../../warehouse/fiscal/invoices/invoice/helpers/custom-filters";
import { SaleTransferInvoiceReportScope } from "../../models/sale-transfer-invoice-report.types";
import { SALE_INVOICE_ALIAS } from "./sale-transfer-invoice-report.attributes";

/** Where do include `unitBusinessAttributes` (required): mesma loja/tipo do relatório de produtos. */
export function unitBusinessAttributesScopeWhere(
  scope: Pick<SaleTransferInvoiceReportScope, "unitBusinessId" | "type">,
): WhereOptions {
  return { unit_business_id: scope.unitBusinessId, type: scope.type };
}

/** Filtros próprios do relatório; vazio = sem filtro. */
export function saleTransferReportWhere(
  scope: Pick<SaleTransferInvoiceReportScope, "originUnitBusinessIds" | "productIds">,
  saleInvoiceAlias: string = SALE_INVOICE_ALIAS,
): WhereOptions {
  const conditions: WhereOptions[] = [];
  if (scope.originUnitBusinessIds.length) {
    conditions.push(invoiceOriginUnitBusinessWhere(scope.originUnitBusinessIds));
  }
  if (scope.productIds.length) {
    conditions.push(invoiceProductWhere(scope.productIds, saleInvoiceAlias));
  }
  return { [Op.and]: conditions };
}
