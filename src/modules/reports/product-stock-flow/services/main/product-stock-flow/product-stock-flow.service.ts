import { Op } from "sequelize";
import {
  endOfDayTz,
  startOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";
import unitBusinessService, {
  CD21_UNIT_BUSINESS_NUMBER,
} from "../../../../../company/unit-business/unit-business.service";
import productService from "../../../../../inventory/products/services/product.service";
import productConfigService from "../../../../../inventory/product-config/product_config.service";
import {
  ProductStockFlowParams,
  ProductStockFlowReport,
} from "../../../models/product-stock-flow.types";
import productStockFlowRepository, {
  ProductStockFlowRepository,
} from "../../../repositories/main/product-stock-flow/product-stock-flow.repository";
import {
  aggregateProductStockFlow,
  listMonthsDescending,
  ProductInfo,
} from "./product-stock-flow.aggregation";

export class ProductStockFlowService {
  constructor(
    private readonly repository: ProductStockFlowRepository = productStockFlowRepository,
  ) {}

  async getReport(
    params: ProductStockFlowParams,
  ): Promise<ProductStockFlowReport> {
    const store = await unitBusinessService.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
      attributes: ["id", "number"],
    });
    if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");

    const start = startOfDayTz(params.startDate).toDate();
    const end = endOfDayTz(params.endDate).toDate();

    const [inputs, outputs, returns] = await Promise.all([
      this.repository.aggregateInputs(store.id, start, end),
      this.repository.aggregateOutputs(store.id, start, end),
      this.repository.aggregateReturns(store.id, start, end),
    ]);

    const productInfo = await this.loadProductInfo(
      [...inputs, ...outputs, ...returns].map((row) => row.product_id),
      store.id,
    );

    const aggregated = aggregateProductStockFlow(
      inputs,
      outputs,
      returns,
      productInfo,
      listMonthsDescending(params.startDate, params.endDate),
    );

    return {
      filters: {
        store_id: Number(store.number),
        unit_business_id: store.id,
        start_date: params.startDate,
        end_date: params.endDate,
      },
      ...aggregated,
    };
  }

  private async loadProductInfo(
    productIds: string[],
    unitBusinessId: string,
  ): Promise<Map<string, ProductInfo>> {
    const info = new Map<string, ProductInfo>();
    const ids = [...new Set(productIds)];
    if (!ids.length) return info;

    const [products, configs] = await Promise.all([
      productService.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ["id", "name"],
      }),
      productConfigService.findAll({
        where: { product_id: { [Op.in]: ids }, unit_business_id: unitBusinessId },
        attributes: ["product_id", "sku"],
      }),
    ]);

    for (const product of products) {
      info.set(product.id, { name: product.name, sku: null });
    }
    for (const config of configs) {
      const current = info.get(config.product_id) ?? { name: null, sku: null };
      info.set(config.product_id, { ...current, sku: config.sku ?? null });
    }

    return info;
  }
}

export default new ProductStockFlowService();
