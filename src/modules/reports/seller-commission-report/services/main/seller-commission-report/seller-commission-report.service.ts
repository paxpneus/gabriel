import { Op } from "sequelize";
import {
  endOfDayTz,
  startOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";
import unitBusinessService, {
  CD21_UNIT_BUSINESS_NUMBER,
} from "../../../../../company/unit-business/unit-business.service";
import productService from "../../../../../inventory/products/services/product.service";
import contactService from "../../../../../sales/contacts/contacts.service";
import { SELLER_MANAGER_CONTACT_TYPE } from "../../../../../sales/contacts/contacts.types";
import {
  SellerCommissionReport,
  SellerCommissionReportParams,
  SellerCommissionSaleInvoices,
} from "../../../models/seller-commission-report.types";
import sellerCommissionReportRepository, {
  SellerCommissionReportRepository,
} from "../../../repositories/main/seller-commission-report/seller-commission-report.repository";
import {
  buildReportRows,
  buildSummary,
  classifyInvoices,
  PeopleFilter,
} from "./seller-commission-report.aggregation";

export class SellerCommissionReportService {
  constructor(
    private readonly repository: SellerCommissionReportRepository = sellerCommissionReportRepository,
  ) {}

  /** Comissão de vendedor e gerente do seller report, pela base de saídas do Kardex do CD21 (movimento → nota → pedido). */
  async getReport(params: SellerCommissionReportParams): Promise<SellerCommissionReport> {
    // Marca vira lista de product_id (como no stock flow); com produto também, fica a interseção.
    let productIds = params.productIds?.length ? params.productIds : undefined;
    if (params.brands?.length) {
      const brandProducts = await productService.findAll({
        where: { brand: { [Op.in]: params.brands } },
        attributes: ["id"],
      });
      const brandProductIds = brandProducts.map((product) => product.id);
      productIds = productIds
        ? productIds.filter((id) => brandProductIds.includes(id))
        : brandProductIds;
    }

    // Gerente (contato SELLER_MANAGER) filtra pelas vendas da loja dele (contacts.unit_business_id).
    const peopleFilter: PeopleFilter = {
      sellerIds: params.sellerIds?.length ? params.sellerIds : undefined,
    };
    if (params.managerIds?.length) {
      const managers = await contactService.findAll({
        where: { id: { [Op.in]: params.managerIds }, type: SELLER_MANAGER_CONTACT_TYPE },
        attributes: ["unit_business_id"],
      });
      peopleFilter.unitBusinessIds = managers
        .map((manager) => manager.unit_business_id)
        .filter((unitBusinessId): unitBusinessId is string => !!unitBusinessId);
    }

    const { unitBusinessId, invoices, withoutMovement } = await this.findSaleInvoices(
      params.startDate,
      params.endDate,
      productIds,
    );
    const { includedByOrder, warnings } = classifyInvoices(invoices, withoutMovement, peopleFilter);
    const items = await this.repository.findCommissionRows([...includedByOrder.keys()], {
      productIds,
      ...peopleFilter,
    });

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        unit_business_id: unitBusinessId,
        brand: params.brands?.length ? params.brands : null,
        product_id: params.productIds?.length ? params.productIds : null,
        seller_id: params.sellerIds?.length ? params.sellerIds : null,
        manager_id: params.managerIds?.length ? params.managerIds : null,
      },
      rows: buildReportRows(items, includedByOrder),
      summary: buildSummary(items),
      warnings,
    };
  }

  /** Saídas do Kardex do CD21 no período (movimento → nota → pedido) e saídas sem movimento; também lido pelo relatório de problemas de integração. */
  async findSaleInvoices(
    startDate: string,
    endDate: string,
    productIds?: string[],
  ): Promise<SellerCommissionSaleInvoices> {
    const store = await unitBusinessService.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
      attributes: ["id"],
    });
    if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");

    const start = startOfDayTz(startDate).toDate();
    const end = endOfDayTz(endDate).toDate();
    const [movementIds, withoutMovement] = await Promise.all([
      this.repository.findSaleMovementIds(store.id, start, end, productIds),
      this.repository.findInvoicesWithoutMovement(store.id, start, end, productIds),
    ]);
    const invoices = await this.repository.findMovementInvoices(movementIds);
    return { unitBusinessId: store.id, invoices, withoutMovement };
  }
}

export default new SellerCommissionReportService();
