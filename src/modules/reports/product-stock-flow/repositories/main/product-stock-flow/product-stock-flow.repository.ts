import { Op } from "sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  inputMovementsWhere,
  outputMovementsWhere,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import {
  ProductStockFlowInputRow,
  ProductStockFlowOutputRow,
} from "../../../models/product-stock-flow.types";
import {
  inputAggregateAttributes,
  outputAggregateAttributes,
  PRODUCT_STOCK_FLOW_GROUP,
} from "../../query-objects/product-stock-flow.aggregates";

export class ProductStockFlowRepository {
  async aggregateInputs(
    unitBusinessId: string,
    start: Date,
    end: Date,
  ): Promise<ProductStockFlowInputRow[]> {
    return StockMovement.findAll({
      where: {
        [Op.and]: [
          unitBusinessPeriodWhere(unitBusinessId, start, end),
          inputMovementsWhere(),
        ],
      },
      attributes: inputAggregateAttributes(),
      group: PRODUCT_STOCK_FLOW_GROUP,
      raw: true,
    }) as unknown as Promise<ProductStockFlowInputRow[]>;
  }

  async aggregateOutputs(
    unitBusinessId: string,
    start: Date,
    end: Date,
  ): Promise<ProductStockFlowOutputRow[]> {
    return StockMovement.findAll({
      where: {
        [Op.and]: [
          unitBusinessPeriodWhere(unitBusinessId, start, end),
          outputMovementsWhere(),
        ],
      },
      attributes: outputAggregateAttributes(),
      group: PRODUCT_STOCK_FLOW_GROUP,
      raw: true,
    }) as unknown as Promise<ProductStockFlowOutputRow[]>;
  }
}

export default new ProductStockFlowRepository();
