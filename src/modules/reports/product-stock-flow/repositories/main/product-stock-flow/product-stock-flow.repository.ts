import { Op, QueryTypes, WhereOptions } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import { APP_TIMEZONE } from "../../../../../../shared/utils/normalizers/date";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  customerReturnMovementsWhere,
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

  /**
   * Entradas por (mês, produto) na data de emissão da nota de entrada da unidade com `number_system` = `invoice_number`;
   * sem nota, vale a data do Kardex. Período e mês saem dessa data, não da movimentação.
   */
  async aggregateInputs(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
  ): Promise<ProductStockFlowInputRow[]> {
    if (productIds && !productIds.length) return [];

    const productFilter = productIds
      ? "AND m.product_id = ANY(string_to_array(:productIds, ',')::uuid[])"
      : "";

    return sequelize.query<ProductStockFlowInputRow>(
      `
      -- CTE única: number_system não tem índice (subquery por movimento varreria invoices a cada linha).
      -- Mais de uma entrada com o mesmo nº (fornecedores diferentes) → vale a emissão mais antiga.
      WITH nf AS (
        SELECT i.number_system, MIN(i.emitted_at) AS emitted_at
        FROM invoices i
        JOIN invoice_unit_business_attributes uba ON uba.invoice_id = i.id
        WHERE uba.unit_business_id = :unitBusinessId
          AND uba.type = 'INCOMING'
          AND i.emitted_at IS NOT NULL
        GROUP BY i.number_system
      ),
      mv AS (
        SELECT m.product_id, m.movement_quantity, m.net_total_amount,
               COALESCE(nf.emitted_at, m.movement_date) AS effective_date
        FROM stock_movements m
        LEFT JOIN nf ON nf.number_system = m.invoice_number
        WHERE m.unit_business_id = :unitBusinessId
          AND m.is_active
          AND m.movement_type = 'PURCHASE_ENTRY'
          ${productFilter}
      )
      SELECT
        to_char(date_trunc('month', effective_date AT TIME ZONE :timezone), 'YYYY-MM') AS month,
        product_id,
        SUM(movement_quantity) AS total_input_quantity,
        SUM(net_total_amount) AS total_input_value,
        COUNT(*) FILTER (WHERE net_total_amount IS NULL) AS inputs_without_net_amount
      FROM mv
      WHERE effective_date BETWEEN :start AND :end
      GROUP BY 1, 2
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          unitBusinessId,
          start,
          end,
          timezone: APP_TIMEZONE,
          productIds: productIds?.join(",") ?? "",
        },
      },
    );
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
