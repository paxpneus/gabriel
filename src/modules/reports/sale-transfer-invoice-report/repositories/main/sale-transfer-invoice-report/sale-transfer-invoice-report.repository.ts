import { Op } from "sequelize";
import Invoice from "../../../../../warehouse/fiscal/invoices/invoice/invoice.model";
import InvoiceUnitBusinessAttributes from "../../../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import Order from "../../../../../sales/orders/order/orders.model";
import UnitBusiness from "../../../../../company/unit-business/unit-business.model";
import { QueryParser } from "../../../../../../shared/query/query.parser";
import {
  QueryConfig,
  QueryParams,
} from "../../../../../../shared/query/query.types";
import {
  SaleTransferInvoiceReportScope,
  SaleTransferInvoiceRow,
} from "../../../models/sale-transfer-invoice-report.types";
import {
  INVOICE_ATTRIBUTES_ROW_ATTRIBUTES,
  ORDER_ROW_ATTRIBUTES,
  saleInvoiceRowAttributes,
  UNIT_BUSINESS_ROW_ATTRIBUTES,
} from "../../query-objects/sale-transfer-invoice-report.attributes";
import {
  saleTransferReportWhere,
  unitBusinessAttributesScopeWhere,
} from "../../query-objects/sale-transfer-invoice-report.filters";

export class SaleTransferInvoiceReportRepository {
  /** Uma linha por nota de venda, sem paginação; `filters[...]` resolvidos pelo queryConfig de invoice. */
  async findRows(
    params: QueryParams,
    invoiceQueryConfig: QueryConfig,
    scope: SaleTransferInvoiceReportScope,
  ): Promise<SaleTransferInvoiceRow[]> {
    const { where, order } = QueryParser.parse(params, invoiceQueryConfig);

    return Invoice.findAll({
      subQuery: false,
      attributes: saleInvoiceRowAttributes(),
      where: { [Op.and]: [where, saleTransferReportWhere(scope)] },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          attributes: INVOICE_ATTRIBUTES_ROW_ATTRIBUTES,
          where: unitBusinessAttributesScopeWhere(scope),
          include: [
            { model: UnitBusiness, as: "unitBusiness", attributes: UNIT_BUSINESS_ROW_ATTRIBUTES },
          ],
        },
        { model: UnitBusiness, as: "originUnitBusiness", attributes: UNIT_BUSINESS_ROW_ATTRIBUTES },
        { model: Order, as: "order", attributes: ORDER_ROW_ATTRIBUTES },
      ],
      order,
      raw: true,
      nest: true,
    }) as unknown as Promise<SaleTransferInvoiceRow[]>;
  }
}

export default new SaleTransferInvoiceReportRepository();
