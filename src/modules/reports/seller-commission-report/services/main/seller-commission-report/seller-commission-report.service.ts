import { Op } from "sequelize";
import unitBusinessGroupMemberService from "../../../../../company/unit-business-groups/unit-business-group-member/unit-business-group-member.service";
import productService from "../../../../../inventory/products/services/product.service";
import contactService from "../../../../../sales/contacts/contacts.service";
import { SELLER_MANAGER_CONTACT_TYPE } from "../../../../../sales/contacts/contacts.types";
import {
  SellerCommissionReport,
  SellerCommissionReportParams,
} from "../../../models/seller-commission-report.types";
import sellerCommissionReportRepository, {
  CommissionFilters,
  SellerCommissionReportRepository,
} from "../../../repositories/main/seller-commission-report/seller-commission-report.repository";
import { buildReportRows, buildSummary } from "./seller-commission-report.aggregation";

export class SellerCommissionReportService {
  constructor(
    private readonly repository: SellerCommissionReportRepository = sellerCommissionReportRepository,
  ) {}

  /** Comissão de vendedor e gerente dos pedidos faturados do seller report, pela data do pedido (mesma base do seller report). */
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

    const filters: CommissionFilters = {
      startDate: params.startDate,
      endDate: params.endDate,
      productIds,
      sellerIds: params.sellerIds?.length ? params.sellerIds : undefined,
      unitBusinessIds: params.unitBusinessIds?.length ? params.unitBusinessIds : undefined,
      originUnitBusinessIds: params.originUnitBusinessIds?.length ? params.originUnitBusinessIds : undefined,
    };
    // Gerente (contato SELLER_MANAGER) filtra pela loja dele + lojas do grupo do regional; com filtro de loja junto, fica a interseção.
    if (params.managerIds?.length) {
      const managers = await contactService.findAll({
        where: { id: { [Op.in]: params.managerIds }, type: SELLER_MANAGER_CONTACT_TYPE },
        attributes: ["unit_business_id", "unit_business_group_id"],
      });
      const managerUnitBusinessIds = managers
        .map((manager) => manager.unit_business_id)
        .filter((unitBusinessId): unitBusinessId is string => !!unitBusinessId);
      const groupIds = managers
        .map((manager) => manager.unit_business_group_id)
        .filter((groupId): groupId is string => !!groupId);
      if (groupIds.length) {
        const members = await unitBusinessGroupMemberService.findAll({
          where: { unit_business_group_id: { [Op.in]: groupIds } },
          attributes: ["unit_business_id"],
        });
        managerUnitBusinessIds.push(...members.map((member) => member.unit_business_id));
      }
      filters.unitBusinessIds = filters.unitBusinessIds
        ? filters.unitBusinessIds.filter((id) => managerUnitBusinessIds.includes(id))
        : managerUnitBusinessIds;
    }

    const [items, warnings] = await Promise.all([
      this.repository.findCommissionRows(filters),
      this.repository.countOrderWarnings(filters),
    ]);

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        brand: params.brands?.length ? params.brands : null,
        product_id: params.productIds?.length ? params.productIds : null,
        seller_id: params.sellerIds?.length ? params.sellerIds : null,
        manager_id: params.managerIds?.length ? params.managerIds : null,
        unit_business_id: params.unitBusinessIds?.length ? params.unitBusinessIds : null,
        origin_unit_business_id: params.originUnitBusinessIds?.length ? params.originUnitBusinessIds : null,
      },
      rows: buildReportRows(items),
      summary: buildSummary(items),
      warnings,
    };
  }
}

export default new SellerCommissionReportService();
