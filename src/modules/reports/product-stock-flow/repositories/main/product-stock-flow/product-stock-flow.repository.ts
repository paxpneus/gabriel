import { Op, WhereOptions } from "sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  customerReturnMovementsWhere,
  inputMovementsWhere,
  outputMovementsWhere,
  saleUnitBusinessWhere,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import {
  ProductStockFlowInputRow,
  ProductStockFlowOutputRow,
  ProductStockFlowReturnRow,
} from "../../../models/product-stock-flow.types";
import {
  inputAggregateAttributes,
  outputAggregateAttributes,
  PRODUCT_STOCK_FLOW_GROUP,
  returnAggregateAttributes,
} from "../../query-objects/product-stock-flow.aggregates";

export class ProductStockFlowRepository {
  // Unidade + período + tipo de movimento; `productIds` (marca) e `saleUnitBusinessIds` (loja da venda) só restringem quando vierem.
  private scopeWhere(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds: string[] | undefined,
    movementWhere: WhereOptions,
    saleUnitBusinessIds?: string[],
  ): WhereOptions {
    const conditions: WhereOptions[] = [
      unitBusinessPeriodWhere(unitBusinessId, start, end),
      movementWhere,
    ];
    if (productIds) conditions.push({ product_id: { [Op.in]: productIds } });
    if (saleUnitBusinessIds?.length) conditions.push(saleUnitBusinessWhere(saleUnitBusinessIds));
    return { [Op.and]: conditions };
  }

  async aggregateInputs(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
  ): Promise<ProductStockFlowInputRow[]> {
    return StockMovement.findAll({
      where: this.scopeWhere(unitBusinessId, start, end, productIds, inputMovementsWhere()),
      attributes: inputAggregateAttributes(),
      group: PRODUCT_STOCK_FLOW_GROUP,
      raw: true,
    }) as unknown as Promise<ProductStockFlowInputRow[]>;
  }

  async aggregateOutputs(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
    saleUnitBusinessIds?: string[],
  ): Promise<ProductStockFlowOutputRow[]> {
    return StockMovement.findAll({
      where: this.scopeWhere(unitBusinessId, start, end, productIds, outputMovementsWhere(), saleUnitBusinessIds),
      attributes: outputAggregateAttributes(),
      group: PRODUCT_STOCK_FLOW_GROUP,
      raw: true,
    }) as unknown as Promise<ProductStockFlowOutputRow[]>;
  }

  async aggregateReturns(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
    saleUnitBusinessIds?: string[],
  ): Promise<ProductStockFlowReturnRow[]> {
    return StockMovement.findAll({
      where: this.scopeWhere(unitBusinessId, start, end, productIds, customerReturnMovementsWhere(), saleUnitBusinessIds),
      attributes: returnAggregateAttributes(),
      group: PRODUCT_STOCK_FLOW_GROUP,
      raw: true,
    }) as unknown as Promise<ProductStockFlowReturnRow[]>;
  }
}

export default new ProductStockFlowRepository();
