import SalesOrderItemSnapshot from "../../../../daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.model";
import SalesOrderSnapshot from "../../../../daily-sales/sales-order-snapshot/sales-order-snapshot.model";
import UnitBusiness from "../../../../../company/unit-business/unit-business.model";
import Invoice from "../../../../../warehouse/fiscal/invoices/invoice/invoice.model";
import Contact from "../../../../../sales/contacts/contacts.model";
import Product from "../../../../../inventory/products/product.model";
import Brand from "../../../../../inventory/brands/brands.model";
import {
  SalesInvoicedItemRow,
  SalesInvoicedTotalsRow,
} from "../../../models/sales-invoiced-report.types";
import {
  BRAND_ROW_ATTRIBUTES,
  invoiceRowAttributes,
  ITEM_ROW_ATTRIBUTES,
  ORDER_ROW_ATTRIBUTES,
  ORDER_SNAPSHOT_INCLUDE_ALIAS,
  PRODUCT_ROW_ATTRIBUTES,
  ROW_ORDER,
  SELLER_ROW_ATTRIBUTES,
  UNIT_BUSINESS_ROW_ATTRIBUTES,
} from "../../query-objects/sales-invoiced-report.attributes";
import {
  TOTALS_SNAPSHOT_ALIAS,
  totalsAggregateAttributes,
} from "../../query-objects/sales-invoiced-report.aggregates";
import { invoicedReportWhere } from "../../query-objects/sales-invoiced-report.filters";

export class SalesInvoicedReportRepository {
  /** Uma linha por item; o filtro vai no pedido (o item não tem status próprio). */
  async findRows(
    integrationId: string,
    startDate: string,
    endDate: string,
  ): Promise<SalesInvoicedItemRow[]> {
    return SalesOrderItemSnapshot.findAll({
      attributes: ITEM_ROW_ATTRIBUTES,
      include: [
        {
          model: SalesOrderSnapshot,
          as: ORDER_SNAPSHOT_INCLUDE_ALIAS,
          required: true,
          where: invoicedReportWhere(
            integrationId,
            startDate,
            endDate,
            ORDER_SNAPSHOT_INCLUDE_ALIAS,
          ),
          attributes: ORDER_ROW_ATTRIBUTES,
          include: [
            { model: UnitBusiness, as: "unitBusiness", attributes: UNIT_BUSINESS_ROW_ATTRIBUTES },
            { model: Invoice, as: "invoice", attributes: invoiceRowAttributes() },
            { model: Contact, as: "seller", attributes: SELLER_ROW_ATTRIBUTES },
          ],
        },
        {
          model: Product,
          as: "product",
          attributes: PRODUCT_ROW_ATTRIBUTES,
          include: [
            { model: Brand, as: "brandRegister", attributes: BRAND_ROW_ATTRIBUTES },
          ],
        },
      ],
      order: ROW_ORDER,
      raw: true,
      nest: true,
    }) as unknown as Promise<SalesInvoicedItemRow[]>;
  }

  async aggregateTotals(
    integrationId: string,
    startDate: string,
    endDate: string,
  ): Promise<SalesInvoicedTotalsRow | null> {
    const [totals] = (await SalesOrderSnapshot.findAll({
      where: invoicedReportWhere(
        integrationId,
        startDate,
        endDate,
        TOTALS_SNAPSHOT_ALIAS,
      ),
      attributes: totalsAggregateAttributes(),
      raw: true,
    })) as unknown as SalesInvoicedTotalsRow[];
    return totals ?? null;
  }
}

export default new SalesInvoicedReportRepository();
