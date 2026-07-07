// sales report
import { QueryTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  SalesFactKey,
  SalesProductFactKey,
  SalesReportFilters,
  SalesStateFactKey,
  SalesStatusFactKey,
  SalesStoreFactKey,
} from "./sales-report.types";

const JOB_NAME = "sales_report";

interface CheckpointRow {
  last_processed_at: Date;
}

interface OrderIdRow {
  order_id: string;
}

type ReportRow = Record<string, unknown>;

type SqlExpression = string;

interface DecimalAndPercentSql {
  decimal: SqlExpression;
  percent: SqlExpression;
}

export interface SalesReportOrderItemInput {
  sku: string;
  quantity: number;
  average_cost_snapshot: number | null;
  commission_base?: number | null;
  commission_rate?: number | null;
  commission_value?: number | null;
  total_cost_snapshot?: number | null;
  net_total: number;
}

export interface SalesReportOrderInput {
  id: string;
  total_price: number;
  total_order?: number | null;
  // Receita bruta do pedido. TODAS as contas de markup/receita usam este
  // campo, sem descontar tax_commission, freight_cost ou ICMS.
  total_products: number;
  discount_value?: number | null;
  destination_uf?: string | null;
  // Alíquota de ICMS do estado de destino, em decimal (ex: 0.148 = 14.8%).
  // Deve ser resolvida pelo chamador via tabela states (acronym = destination_uf)
  // antes de montar este input.
  icms_rate?: number | null;
  tax_commission?: number | null;
  marketplace_fee?: number | null;
  payment_fee?: number | null;
  freight_cost?: number | null;
  freight_charged?: number | null;
  icms_value?: number | null;
  total_cost?: number | null;
  seller?: { name?: string | null } | null;
  items: SalesReportOrderItemInput[];
}

export interface SalesReportItemFinancialMetrics {
  sku: string;
  quantity: number;
  productCost: number;
  commission: number;
  orderItemTotalCost: number;
  allocatedMarketplaceFee: number;
  allocatedFreightCost: number;
  productProfit: number;
}

export interface SalesReportOrderFinancialMetrics {
  orderId: string;
  revenue: number;
  totalCost: number;
  profit: number;
  contributionValue: number;
  contributionPct: number;
  markup: number;
  markupPct: number;
  totalCommission: number;
  // totalTaxes/totalFees/totalFreight abaixo são valores extraídos deste
  // pedido especificamente para efeito de CONTRIBUTION (icms calculado,
  // tax_commission e freight_cost). Servem apenas para acumular nos totais
  // do summary — não retroalimentam o cálculo de nenhum outro pedido.
  totalTaxes: number;
  totalFees: number;
  totalFreight: number;
  itemsQuantity: number;
  items: SalesReportItemFinancialMetrics[];
}

export interface SalesReportAggregateFinancialMetrics {
  orders_count: number;
  items_quantity: number;
  total_value: number;
  total_cost: number;
  total_profit: number;
  total_commission: number;
  total_taxes: number;
  total_fees: number;
  total_freight: number;
  contribution_value: number;
  contribution_pct: number;
  markup: number;
  markup_pct: number;
  average_ticket: number;
}

// FUTURO constants: nomes de jobs, status e aliases SQL podem sair para constants.
const COMPLETED_SALES_STATUSES = "('open', 'completed')";

// FUTURO helpers/calculators: este bloco concentra regras reutilizadas do relatório.
// Mantemos aqui nesta refatoração para facilitar revisão, mas ele é candidato direto
// para um arquivo de calculators SQL do relatório.
const coalesceNumberSql = (expression: SqlExpression): SqlExpression =>
  `COALESCE(${expression}, 0)`;

const roundSql = (
  expression: SqlExpression,
  decimalPlaces = 2,
): SqlExpression => `ROUND((${expression})::numeric, ${decimalPlaces})`;

const calculateSafeDivisionSql = (
  numerator: SqlExpression,
  denominator: SqlExpression,
  decimalPlaces = 2,
): SqlExpression => `
CASE
  WHEN ${coalesceNumberSql(denominator)} = 0 THEN 0
  ELSE ${roundSql(
    `(${numerator}) / NULLIF((${denominator}), 0)`,
    decimalPlaces,
  )}
END`;

const calculateProfitSql = (
  revenue: SqlExpression,
  cost: SqlExpression,
): SqlExpression => `${coalesceNumberSql(revenue)} - ${coalesceNumberSql(cost)}`;

const calculatePercentageSql = (
  numerator: SqlExpression,
  denominator: SqlExpression,
): SqlExpression =>
  calculateSafeDivisionSql(`(${numerator}) * 100`, denominator, 2);

const calculateAverageTicketSql = (
  totalRevenue: SqlExpression,
  totalOrders: SqlExpression,
): SqlExpression => calculateSafeDivisionSql(totalRevenue, totalOrders, 2);

const calculateAverageValueSql = (
  totalValue: SqlExpression,
  quantity: SqlExpression,
): SqlExpression => calculateSafeDivisionSql(totalValue, quantity, 2);

const calculateMarkupSql = (
  revenue: SqlExpression,
  cost: SqlExpression,
): DecimalAndPercentSql => {
  const profit = calculateProfitSql(revenue, cost);

  return {
    // Markup representa o quanto o lucro acrescenta sobre o custo.
    // revenue = SEMPRE valor bruto (total_products / gross_total), sem
    // descontar tax_commission, freight_cost ou ICMS.
    // cost    = SEMPRE soma bruta de total_cost_snapshot, sem ICMS somado.
    decimal: calculateSafeDivisionSql(profit, cost, 4),
    percent: calculatePercentageSql(profit, cost),
  };
};

/**
 * Contribution (lucro real do pedido) — ÚNICO lugar do relatório onde
 * tax_commission, freight_cost e o ICMS calculado via alíquota do estado de
 * destino entram na conta. Fórmula (por pedido):
 *
 *   temp_icms    = (total_products - discount_value) * state.icms_rate
 *   contribution = total_products - tax_commission - freight_cost
 *                  - temp_icms - SUM(order_item.total_cost_snapshot)
 *
 * temp_icms é calculado e persistido em sales_order_snapshots.computed_icms_value
 * (ver order_source/inserted_orders em upsertSnapshots). A partir daí, tanto
 * upsertSnapshots quanto updateSnapshotTotals só leem essa coluna já pronta.
 */
const calculateOrderContributionValueSql = (
  snapshotAlias: string,
  costExpression: SqlExpression,
): SqlExpression => `
  ${coalesceNumberSql(`${snapshotAlias}.total_products`)}
- ${coalesceNumberSql(`${snapshotAlias}.tax_commission`)}
- ${coalesceNumberSql(`${snapshotAlias}.freight_cost`)}
- ${coalesceNumberSql(`${snapshotAlias}.computed_icms_value`)}
- ${coalesceNumberSql(costExpression)}`;

const calculateOrderContributionPctSql = (
  snapshotAlias: string,
  costExpression: SqlExpression,
): SqlExpression =>
  calculatePercentageSql(
    calculateOrderContributionValueSql(snapshotAlias, costExpression),
    `${snapshotAlias}.total_products`,
  );

const calculateTotalTaxesSql = (alias: string): SqlExpression =>
  coalesceNumberSql(`${alias}.computed_icms_value`);

const calculateTotalFeesSql = (alias: string): SqlExpression => `
  ${coalesceNumberSql(`${alias}.tax_commission`)}
+ ${coalesceNumberSql(`${alias}.marketplace_fee`)}
+ ${coalesceNumberSql(`${alias}.payment_fee`)}`;

const hasCompleteCostSql = (snapshotAlias: string): SqlExpression => `
NOT EXISTS (
  SELECT 1
  FROM sales_order_item_snapshots cost_check
  WHERE cost_check.order_snapshot_id = ${snapshotAlias}.id
    AND ${coalesceNumberSql("cost_check.average_cost_snapshot")} <= 0
)`;

const isCompletedSaleSql = (snapshotAlias: string): SqlExpression =>
  `${snapshotAlias}.snapshot_status IN ${COMPLETED_SALES_STATUSES}
            AND ${hasCompleteCostSql(snapshotAlias)}`;

const toNumber = (value: number | string | null | undefined): number =>
  value == null ? 0 : Number(value);

const divide = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const isMarketplaceOrder = (order: SalesReportOrderInput): boolean =>
  (order.seller?.name ?? "").trim() === "Vendedor 0";

export const calculateSalesReportOrderFinancials = (
  order: SalesReportOrderInput,
): SalesReportOrderFinancialMetrics | null => {
  if (
    order.items.some((item) => toNumber(item.average_cost_snapshot) <= 0)
  ) {
    return null;
  }

  // Receita bruta: SEMPRE total_products. Não descontamos tax_commission,
  // freight_cost nem ICMS aqui — essa é a base pra markup, receita de loja e
  // receita de produto.
  const revenue = toNumber(order.total_products);

  const items = order.items.map((item) => {
    const quantity = toNumber(item.quantity);
    const averageCost = toNumber(item.average_cost_snapshot);
    const productCost = averageCost * quantity;
    const commission =
      item.commission_value != null
        ? toNumber(item.commission_value)
        : toNumber(item.commission_base) * toNumber(item.commission_rate);
    // Custo do item: SEMPRE total_cost_snapshot quando existir (valor bruto
    // já gravado no snapshot). Sem somar ICMS aqui — ICMS não compõe custo,
    // só entra na conta de contribution lá embaixo.
    const orderItemTotalCost =
      item.total_cost_snapshot != null
        ? toNumber(item.total_cost_snapshot)
        : productCost + commission;
    const productProfit = toNumber(item.net_total) - orderItemTotalCost;

    return {
      sku: item.sku,
      quantity,
      productCost,
      commission,
      orderItemTotalCost,
      allocatedMarketplaceFee: 0,
      allocatedFreightCost: 0,
      productProfit,
    };
  });

  // Custo total = soma bruta do total_cost_snapshot de todos os itens.
  const totalCost = items.reduce(
    (sum, item) => sum + item.orderItemTotalCost,
    0,
  );

  // "Lucro" de markup: puramente receita bruta - custo bruto, sem descontar
  // comissão/frete/ICMS. É o que mede quanto se joga acima do custo.
  const profit = revenue - totalCost;

  // ------------------------------------------------------------------
  // Contribution: único cálculo que usa tax_commission, freight_cost e o
  // ICMS calculado via alíquota do estado de destino.
  // ------------------------------------------------------------------
  const discountValue = toNumber(order.discount_value);
  const icmsRate = toNumber(order.icms_rate) / 100;
  const taxCommission = toNumber(order.tax_commission);
  const freightCost = toNumber(order.freight_cost);

  const tempIcms = (revenue - discountValue) * icmsRate;

  const contributionValue =
    revenue - taxCommission - freightCost - tempIcms - totalCost;

  return {
    orderId: order.id,
    revenue,
    totalCost,
    profit,
    contributionValue,
    contributionPct: divide(contributionValue, revenue),
    markup: divide(profit, totalCost),
    markupPct: divide(profit, totalCost) * 100,
    totalCommission: items.reduce((sum, item) => sum + item.commission, 0),
    // Acumuladores "apenas guardando": extraídos deste pedido durante o
    // cálculo de contribution, somados no summary — não influenciam de
    // volta o cálculo de nenhum outro pedido.
    totalTaxes: tempIcms,
    totalFees: taxCommission,
    totalFreight: freightCost,
    itemsQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
};

export const calculateSalesReportAggregateFinancials = (
  orders: SalesReportOrderInput[],
): SalesReportAggregateFinancialMetrics => {
  const validOrders = orders
    .map(calculateSalesReportOrderFinancials)
    .filter(Boolean) as SalesReportOrderFinancialMetrics[];

  const totalValue = validOrders.reduce((sum, order) => sum + order.revenue, 0);
  const totalCost = validOrders.reduce((sum, order) => sum + order.totalCost, 0);
  const totalProfit = validOrders.reduce((sum, order) => sum + order.profit, 0);
  const totalContribution = validOrders.reduce(
    (sum, order) => sum + order.contributionValue,
    0,
  );

  return {
    orders_count: validOrders.length,
    items_quantity: validOrders.reduce(
      (sum, order) => sum + order.itemsQuantity,
      0,
    ),
    total_value: totalValue,
    total_cost: totalCost,
    total_profit: totalProfit,
    total_commission: validOrders.reduce(
      (sum, order) => sum + order.totalCommission,
      0,
    ),
    total_taxes: validOrders.reduce((sum, order) => sum + order.totalTaxes, 0),
    total_fees: validOrders.reduce((sum, order) => sum + order.totalFees, 0),
    total_freight: validOrders.reduce(
      (sum, order) => sum + order.totalFreight,
      0,
    ),
    contribution_value: totalContribution,
    contribution_pct: divide(totalContribution, totalValue),
    markup: divide(totalProfit, totalCost),
    markup_pct: divide(totalProfit, totalCost) * 100,
    average_ticket: divide(totalValue, validOrders.length),
  };
};

export class SalesReportRepository {
  // FUTURO repositories/services:
  // Checkpoint e estado do job podem virar um repository próprio de jobs e
  // serem orquestrados pelo service, deixando este arquivo só com analytics.
  async getCheckpoint(): Promise<Date> {
    await this.ensureCheckpoint();

    const rows = await sequelize.query<CheckpointRow>(
      `
      SELECT last_processed_at
      FROM report_job_checkpoints
      WHERE job_name = :jobName
      LIMIT 1
      `,
      { type: QueryTypes.SELECT, replacements: { jobName: JOB_NAME } },
    );

    if (!rows[0]) {
      throw new Error(
        "Não foi possível inicializar o checkpoint sales_report.",
      );
    }

    return rows[0].last_processed_at;
  }

  private async ensureCheckpoint(): Promise<void> {
    await sequelize.query(
      `
      INSERT INTO report_job_checkpoints (
        job_name,
        last_processed_at,
        last_run_at,
        status,
        rows_processed,
        created_at,
        updated_at
      )
      VALUES (
        :jobName,
        NOW() - INTERVAL '1 day',
        NOW(),
        'success',
        0,
        NOW(),
        NOW()
      )
      ON CONFLICT (job_name) DO NOTHING
      `,
      { replacements: { jobName: JOB_NAME } },
    );
  }

  async markRunning(): Promise<void> {
    const result = await sequelize.query(
      `
    UPDATE report_job_checkpoints
    SET status = 'running', last_run_at = NOW(), updated_at = NOW()
    WHERE job_name = :jobName AND status != 'running'
    `,
      { replacements: { jobName: JOB_NAME } },
    );
  }

  async markSuccess(jobStartTime: Date, rowsProcessed: number): Promise<void> {
    await sequelize.query(
      `
      UPDATE report_job_checkpoints
      SET last_processed_at = :jobStartTime,
          last_run_at = NOW(),
          status = 'success',
          rows_processed = :rowsProcessed,
          metadata = NULL,
          updated_at = NOW()
      WHERE job_name = :jobName
      `,
      {
        replacements: { jobName: JOB_NAME, jobStartTime, rowsProcessed },
      },
    );
  }

  async markFailed(error: Error): Promise<void> {
    await sequelize.query(
      `
      UPDATE report_job_checkpoints
      SET status = 'failed',
          metadata = CAST(:metadata AS jsonb),
          updated_at = NOW()
      WHERE job_name = :jobName
      `,
      {
        replacements: {
          jobName: JOB_NAME,
          metadata: JSON.stringify({ error: error.message }),
        },
      },
    );
  }

  // Fontes de alteração: apenas orders e order_items.
  // Stocks e products não disparam reprocessamento — o custo é congelado
  // no snapshot do momento da venda; backfill de custo histórico é comando separado.
  async findAffectedOrderIds(lastProcessedAt: Date): Promise<string[]> {
    const rows = await sequelize.query<OrderIdRow>(
      `
      SELECT DISTINCT order_id
      FROM (
        SELECT o.id AS order_id
        FROM orders o
        WHERE o.updated_at >= :lastProcessedAt

        UNION

        SELECT oi.order_id
        FROM order_items oi
        WHERE oi.updated_at >= :lastProcessedAt
      ) affected
      WHERE order_id IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { lastProcessedAt } },
    );

    return [...new Set(rows.map((row) => row.order_id))];
  }

  /**
   * NOTA SOBRE contribution_value/contribution_pct (revisão 2):
   *
   * Regra de receita/custo bruto: markup, receita de loja/produto/estado e
   * qualquer conta que dependa do "preço" do pedido usam SEMPRE
   * orders.total_products, sem descontar tax_commission, freight_cost ou
   * ICMS. Custo total é SEMPRE a soma bruta de order_items.total_cost_snapshot
   * — nada mais é somado a ele (nem ICMS, nem comissão de novo).
   *
   * contribution_value/contribution_pct são o ÚNICO lugar do relatório onde
   * tax_commission, freight_cost e um ICMS calculado (não o de nota fiscal)
   * entram na conta, por pedido:
   *
   *   temp_icms    = (total_products - discount_value) * state.icms_rate
   *   contribution = total_products - tax_commission - freight_cost
   *                  - temp_icms - SUM(order_items.total_cost_snapshot)
   *
   * temp_icms é calculado em order_source (join com a tabela states por
   * acronym = destination_uf) e persistido em
   * sales_order_snapshots.computed_icms_value — separado do icms_value de
   * nota fiscal, que continua existindo e sendo apenas armazenado.
   *
   * total_taxes/total_fees continuam sendo somados e armazenados no
   * snapshot/facts para exibição (não retroalimentam markup/receita/custo).
   *
   * NOTA SOBRE comissão de seller:
   * A comissão do vendedor (commission_value) soma dentro do custo do item
   * (total_cost_snapshot) apenas no fallback (quando não veio um
   * total_cost_snapshot já pronto de fora). Além disso é somada à parte em
   * total_commission (por pedido, por dia/unidade, por loja e por produto)
   * pra exibição separada.
   */
  async upsertSnapshots(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    // Custo do item: SEMPRE bruto (average_cost_snapshot * quantity + comissão
    // no fallback, ou o total_cost_snapshot já pronto vindo de fora). NUNCA
    // soma ICMS aqui — ICMS não é custo, só entra em contribution.
    const itemTotalCostSql =
      "COALESCE(total_cost_snapshot_raw, average_cost_snapshot * quantity + commission_value)";
    // Receita usada em markup/facts: SEMPRE total_products (bruto).
    const snapshotRevenueSql = "sos.total_products";
    const snapshotCostSql = "it.total_cost";

    await sequelize.query(
      `
      WITH affected(order_id) AS (
  SELECT DISTINCT unnest(ARRAY[:orderIds]::uuid[])
),

      -- ------------------------------------------------------------------
      -- 1. Fonte de dados do pedido
      --    Join com states pra resolver a alíquota de ICMS do destino e
      --    calcular computed_icms_value = (total_products - discount_value)
      --    * icms_rate. Esse valor é o único usado em contribution — o
      --    icms_value de nota fiscal (o.icms_value) continua sendo lido
      --    e guardado à parte, sem entrar nessa conta.
      -- ------------------------------------------------------------------
      order_source AS (
        SELECT
          o.id                                                  AS order_id,
          o.integrations_id                                     AS integration_id,
          o.customer_id,
          o.store_id,
          o.unit_business_id,
          o.number_order_system                                 AS order_number_system,
          o.number_order_channel                                AS order_number_channel,
          DATE(COALESCE(o.date, o.created_at))                  AS order_date,
          o.destination_uf,
          o.destination_city,
          COALESCE(iosm.normalized_status, o.actual_situation)  AS status_snapshot,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM order_items cost_check
              WHERE cost_check.order_id = o.id
                AND COALESCE(cost_check.average_cost_snapshot, 0) <= 0
            ) THEN 'ignored_missing_cost'
            WHEN o.actual_situation IN ('6', '9') THEN 'completed'
            ELSE 'cancelled'
          END                                                   AS snapshot_status,
          COALESCE(o.total_products, 0)                         AS total_products,
          COALESCE(o.total_price, 0)                            AS total_order,
          COALESCE(o.discount_value, 0)                         AS discount_value,
          COALESCE(o.other_expenses, 0)                         AS other_expenses,
          COALESCE(o.freight_charged, 0)                        AS freight_charged,
          COALESCE(o.freight_cost, 0)                           AS freight_cost,
          COALESCE(o.freight_by_account, 0)                     AS freight_by_account,
          COALESCE(o.tax_commission, 0)                         AS tax_commission,
          COALESCE(o.marketplace_fee, 0)                        AS marketplace_fee,
          COALESCE(o.payment_fee, 0)                            AS payment_fee,
          COALESCE(o.icms_value, 0)                             AS icms_value,
          COALESCE(o.ipi_value, 0)                              AS ipi_value,
          COALESCE(o.pis_value, 0)                              AS pis_value,
          COALESCE(o.cofins_value, 0)                           AS cofins_value,
          COALESCE(o.difal_value, 0)                            AS difal_value,
          COALESCE(o.ibs_value, 0)                              AS ibs_value,
          COALESCE(o.cbs_value, 0)                              AS cbs_value,
          ROUND(
  COALESCE(o.total_price, 0)
  * COALESCE(ubtc.approx_tax_rate, 0), 
  2
) AS approx_tax_value,
          -- ICMS calculado (NÃO o de nota fiscal): base pra contribution.
                    ROUND(
            (COALESCE(o.total_products, 0) - COALESCE(o.discount_value, 0))
            * (COALESCE(st.icms_rate, 0) / 100),
            2
          )                                                     AS computed_icms_value,
          FALSE                                                 AS has_invoice_data,
          o.source_payload
          

        FROM orders o
        JOIN affected a ON a.order_id = o.id
        LEFT JOIN integration_order_status_mappings iosm ON (
          iosm.integration_id     = o.integrations_id
          AND iosm.external_status_id = o.actual_situation
        )
          LEFT JOIN unit_business_tax_configs ubtc 
  ON ubtc.unit_business_id = o.unit_business_id
          LEFT JOIN states st
  ON st.acronym = o.destination_uf
      ),

      -- ------------------------------------------------------------------
      -- 2. Upsert dos snapshots de pedido
      --    RETURNING expande todos os campos necessários pelo item_source,
      --    evitando joins com a tabela base dentro da mesma query CTE
      --    (que não enxergaria rows recém-inseridos via DML CTE).
      -- ------------------------------------------------------------------
      inserted_orders AS (
        INSERT INTO sales_order_snapshots (
          order_id, integration_id, customer_id, store_id, unit_business_id,
          order_number_system, order_number_channel, order_date,
          destination_uf, destination_city, status_snapshot, snapshot_status,
          total_products, total_order, discount_value, other_expenses,
          freight_charged, freight_cost, freight_paid_by_company, freight_by_account,
          tax_commission, marketplace_fee, payment_fee,
          icms_value, ipi_value, pis_value, cofins_value, difal_value,
          ibs_value, cbs_value, approx_tax_value, computed_icms_value,
          has_invoice_data, source_payload,
          last_updated_at, created_at, updated_at
        )
        SELECT
          order_id, integration_id, customer_id, store_id, unit_business_id,
          order_number_system, order_number_channel, order_date,
          destination_uf, destination_city, status_snapshot, snapshot_status,
          total_products, total_order, discount_value, other_expenses,
          freight_charged, freight_cost,
          freight_cost > 0,
          freight_by_account,
          tax_commission, marketplace_fee, payment_fee,
          icms_value, ipi_value, pis_value, cofins_value, difal_value,
          ibs_value, cbs_value, approx_tax_value, computed_icms_value,
          has_invoice_data, source_payload,
          NOW(), NOW(), NOW()
        FROM order_source
        ON CONFLICT (order_id) DO UPDATE SET
          integration_id          = EXCLUDED.integration_id,
          customer_id             = EXCLUDED.customer_id,
          store_id                = EXCLUDED.store_id,
          unit_business_id        = EXCLUDED.unit_business_id,
          order_number_system     = EXCLUDED.order_number_system,
          order_number_channel    = EXCLUDED.order_number_channel,
          order_date              = EXCLUDED.order_date,
          destination_uf          = EXCLUDED.destination_uf,
          destination_city        = EXCLUDED.destination_city,
          status_snapshot         = EXCLUDED.status_snapshot,
          snapshot_status         = EXCLUDED.snapshot_status,
          total_products          = EXCLUDED.total_products,
          total_order             = EXCLUDED.total_order,
          discount_value          = EXCLUDED.discount_value,
          other_expenses          = EXCLUDED.other_expenses,
          freight_charged         = EXCLUDED.freight_charged,
          freight_cost            = EXCLUDED.freight_cost,
          freight_paid_by_company = EXCLUDED.freight_paid_by_company,
          freight_by_account      = EXCLUDED.freight_by_account,
          tax_commission          = EXCLUDED.tax_commission,
          marketplace_fee         = EXCLUDED.marketplace_fee,
          payment_fee             = EXCLUDED.payment_fee,
          icms_value              = EXCLUDED.icms_value,
          ipi_value               = EXCLUDED.ipi_value,
          pis_value               = EXCLUDED.pis_value,
          cofins_value            = EXCLUDED.cofins_value,
          difal_value             = EXCLUDED.difal_value,
          ibs_value               = EXCLUDED.ibs_value,
          cbs_value               = EXCLUDED.cbs_value,
          approx_tax_value        = EXCLUDED.approx_tax_value,
          computed_icms_value     = EXCLUDED.computed_icms_value,
          has_invoice_data        = EXCLUDED.has_invoice_data,
          source_payload          = EXCLUDED.source_payload,
          last_updated_at         = NOW(),
          updated_at              = NOW()
        RETURNING
          id,
          order_id,
          store_id,
          unit_business_id,
          integration_id,
          order_date,
          destination_uf,
          total_products,
          total_order,
          freight_paid_by_company,
          freight_cost,
          icms_value,
          ipi_value,
          pis_value,
          cofins_value,
          difal_value,
          ibs_value,
          cbs_value,
          approx_tax_value,
          computed_icms_value,
          tax_commission,
          marketplace_fee,
          payment_fee
      ),

     -- ------------------------------------------------------------------
-- 3. Fonte de dados dos itens (valores BRUTOS/próprios do item, ainda sem
--    ratear nada do pedido — net_total_raw só serve pra calcular o peso).
-- ------------------------------------------------------------------
item_source_raw AS (
  SELECT
    io.id                                                 AS order_snapshot_id,
    oi.order_id,
    oi.id                                                 AS order_item_id,
    COALESCE(oi.product_id, p.id)                         AS product_id,
    io.store_id,
    io.unit_business_id,
    io.integration_id,
    io.order_date,
    io.destination_uf,
    COALESCE(pc.sku, oi.sku)                              AS sku,
    oi.name                                               AS description,
    oi.unit,
    COALESCE(oi.quantity, 0)::numeric                     AS quantity,
    COALESCE(oi.unit_price, oi.price, 0)::numeric         AS unit_price,
    COALESCE(
      oi.gross_total,
      COALESCE(oi.unit_price, oi.price, 0)::numeric
        * COALESCE(oi.quantity, 0)::numeric
    )                                                     AS gross_total,
    COALESCE(oi.discount_value, 0)                        AS discount_value,
    -- net_total_raw: valor bruto do item (Bling), sem descontar taxa de
    -- marketplace/frete e sem ratear ICMS/IPI/etc. do pedido. É usado
    -- SÓ pra calcular o peso do item dentro do pedido (item_weight),
    -- igual ao seller_sales_report.
    -- net_total_raw: valor bruto do item (sem descontar desconto do item).
    -- Antes subtraíamos discount_value aqui; para cálculo de byproducts
    -- e rateio queremos o preço bruto: quantidade * valor unitário.
    COALESCE(
      oi.net_total,
      COALESCE(oi.gross_total, (COALESCE(oi.unit_price, oi.price, 0)::numeric * COALESCE(oi.quantity, 0)::numeric))
    )                                                     AS net_total_raw,
    COALESCE(oi.average_cost_snapshot, 0)::numeric         AS average_cost_snapshot,
    oi.total_cost_snapshot::numeric                        AS total_cost_snapshot_raw,
    CASE
      WHEN oi.average_cost_snapshot IS NOT NULL THEN 'ORDER_ITEM_SNAPSHOT'
      ELSE 'UNKNOWN'
    END                                                     AS cost_source,
    COALESCE(oi.commission_base, 0)                       AS commission_base,
    COALESCE(oi.commission_rate, 0)                       AS commission_rate,
    COALESCE(oi.commission_value, 0)                      AS commission_value,
    pc.ncm                                                AS ncm,
    pc.cest                                               AS cest,
    NULL::varchar                                         AS cfop,
    COALESCE(pc.gtin, p.ean)                              AS gtin,
    -- valores do PEDIDO (mesmos para todos os itens do mesmo pedido),
    -- carregados aqui só pra servir de base do rateio na próxima CTE.
    -- receita bruta usada pro rateio de item: SEMPRE total_products.
    io.total_products                                     AS order_total_products,
    io.icms_value                                         AS order_icms_value,
    io.ipi_value                                          AS order_ipi_value,
    io.pis_value                                          AS order_pis_value,
    io.cofins_value                                       AS order_cofins_value,
    io.difal_value                                        AS order_difal_value,
    io.ibs_value                                          AS order_ibs_value,
    io.cbs_value                                          AS order_cbs_value,
    io.approx_tax_value                                   AS order_approx_tax_value,
    oi.source_payload
  FROM order_items oi
  JOIN inserted_orders io ON io.order_id = oi.order_id

  -- tenta resolver pelo sku quando não há product_id no item
  LEFT JOIN product_configs pc_by_sku ON (
    oi.product_id IS NULL
    AND pc_by_sku.sku = oi.sku
    AND pc_by_sku.unit_business_id = io.unit_business_id
  )

  -- produto resolvido por id direto ou via pc_by_sku
  LEFT JOIN products p ON (
    p.id = oi.product_id
    OR p.id = pc_by_sku.product_id
  )

  -- product_config definitivo para custo, preço, ncm, gtin etc.
  LEFT JOIN product_configs pc ON (
    pc.product_id = COALESCE(oi.product_id, p.id)
    AND pc.unit_business_id = io.unit_business_id
  )

  LEFT JOIN LATERAL (
    SELECT s.total_price, s.quantity
    FROM stocks s
    WHERE s.product_id = COALESCE(oi.product_id, p.id)
      AND s.quantity > 0
    ORDER BY
      CASE WHEN s.unit_business_id = io.unit_business_id THEN 0 ELSE 1 END,
      s.updated_at DESC
    LIMIT 1
  ) st ON TRUE
),

-- ------------------------------------------------------------------
-- 3b. Peso do item dentro do pedido — mesma lógica do seller_sales_report:
--     item_weight = net_total_raw do item / SUM(net_total_raw) do pedido.
--     A soma dos pesos de todos os itens de um pedido é sempre 1.
-- ------------------------------------------------------------------
item_weighted AS (
  SELECT
    *,
    CASE
      WHEN SUM(net_total_raw) OVER (PARTITION BY order_id) = 0 THEN 0
      ELSE net_total_raw / SUM(net_total_raw) OVER (PARTITION BY order_id)
    END AS item_weight
  FROM item_source_raw
),

-- ------------------------------------------------------------------
-- 3c. Rateio: tudo que só existe no nível do pedido (receita bruta,
--     ICMS/IPI/PIS/COFINS/DIFAL/IBS/CBS/imposto aproximado de nota fiscal —
--     estes são só pra exibição, não entram em custo/contribution) é
--     distribuído entre os itens proporcionalmente ao item_weight.
--     A receita rateada (net_total_allocated) agora usa total_products
--     (bruto), não mais o valor líquido do pedido. Comissão NÃO é rateada —
--     já vem por item.
-- ------------------------------------------------------------------
item_calc AS (
  SELECT
    *,
    ROUND(item_weight * order_total_products, 2)      AS net_total_allocated,
    ROUND(item_weight * order_icms_value, 2)           AS icms_value_allocated,
    ROUND(item_weight * order_ipi_value, 2)            AS ipi_value_allocated,
    ROUND(item_weight * order_pis_value, 2)            AS pis_value_allocated,
    ROUND(item_weight * order_cofins_value, 2)         AS cofins_value_allocated,
    ROUND(item_weight * order_difal_value, 2)          AS difal_value_allocated,
    ROUND(item_weight * order_ibs_value, 2)            AS ibs_value_allocated,
    ROUND(item_weight * order_cbs_value, 2)            AS cbs_value_allocated,
    ROUND(item_weight * order_approx_tax_value, 2)     AS approx_tax_value_allocated
  FROM item_weighted
),

      -- ------------------------------------------------------------------
      -- 4. Upsert dos snapshots de item
      --    RETURNING expande os campos necessários para item_totals.
      --    total_cost_snapshot = custo médio (ou raw) + comissão de seller
      --    no fallback. NÃO soma mais ICMS — ICMS não é custo, só entra em
      --    contribution no nível do pedido.
      -- ------------------------------------------------------------------
      inserted_items AS (
        INSERT INTO sales_order_item_snapshots (
          order_snapshot_id, order_id, order_item_id, product_id,
          store_id, unit_business_id, integration_id, order_date, destination_uf,
          sku, description, unit, quantity, unit_price, gross_total, discount_value,
          net_total, average_cost_snapshot, total_cost_snapshot, cost_source, markup_pct,
          commission_base, commission_rate, commission_value,
          ncm, cest, cfop, gtin,
          approx_tax_value, icms_rate, icms_value, ipi_value, pis_value,
          cofins_value, difal_value, ibs_value, cbs_value,
          source_payload, last_updated_at, created_at, updated_at
        )
        SELECT
          order_snapshot_id, order_id, order_item_id, product_id,
          store_id, unit_business_id, integration_id, order_date, destination_uf,
          sku, description, unit, quantity, unit_price, gross_total, discount_value,
          -- net_total gravado é o valor ALOCADO (rateado do pedido a partir
          -- de total_products), não o líquido.
          net_total_allocated,
          average_cost_snapshot,
          -- Custo bruto do item: raw (se existir) OU average_cost*quantity +
          -- comissão no fallback. Sem somar ICMS.
          COALESCE(total_cost_snapshot_raw, ROUND((average_cost_snapshot * quantity)::numeric, 2) + commission_value),
          cost_source,
          ${calculateMarkupSql("net_total_allocated", itemTotalCostSql).percent},
          commission_base, commission_rate, commission_value,
          ncm, cest, cfop, gtin,
          approx_tax_value_allocated,
          0::numeric AS icms_rate,
          icms_value_allocated,
          ipi_value_allocated,
          pis_value_allocated,
          cofins_value_allocated,
          difal_value_allocated,
          ibs_value_allocated,
          cbs_value_allocated,
          source_payload, NOW(), NOW(), NOW()
        FROM item_calc
        ON CONFLICT (order_item_id) DO UPDATE SET
          order_snapshot_id     = EXCLUDED.order_snapshot_id,
          product_id            = EXCLUDED.product_id,
          store_id              = EXCLUDED.store_id,
          unit_business_id      = EXCLUDED.unit_business_id,
          integration_id        = EXCLUDED.integration_id,
          order_date            = EXCLUDED.order_date,
          destination_uf        = EXCLUDED.destination_uf,
          sku                   = EXCLUDED.sku,
          description           = EXCLUDED.description,
          unit                  = EXCLUDED.unit,
          quantity              = EXCLUDED.quantity,
          unit_price            = EXCLUDED.unit_price,
          gross_total           = EXCLUDED.gross_total,
          discount_value        = EXCLUDED.discount_value,
          net_total             = EXCLUDED.net_total,
          average_cost_snapshot = EXCLUDED.average_cost_snapshot,
          total_cost_snapshot   = EXCLUDED.total_cost_snapshot,
          cost_source           = EXCLUDED.cost_source,
          markup_pct            = EXCLUDED.markup_pct,
          commission_base       = EXCLUDED.commission_base,
          commission_rate       = EXCLUDED.commission_rate,
          commission_value      = EXCLUDED.commission_value,
          ncm                   = EXCLUDED.ncm,
          cest                  = EXCLUDED.cest,
          cfop                  = EXCLUDED.cfop,
          gtin                  = EXCLUDED.gtin,
          approx_tax_value      = EXCLUDED.approx_tax_value,
          icms_rate             = EXCLUDED.icms_rate,
          icms_value            = EXCLUDED.icms_value,
          ipi_value             = EXCLUDED.ipi_value,
          pis_value             = EXCLUDED.pis_value,
          cofins_value          = EXCLUDED.cofins_value,
          difal_value           = EXCLUDED.difal_value,
          ibs_value             = EXCLUDED.ibs_value,
          cbs_value             = EXCLUDED.cbs_value,
          source_payload        = EXCLUDED.source_payload,
          last_updated_at       = NOW(),
          updated_at            = NOW()
        RETURNING
          order_snapshot_id,
          quantity,
          total_cost_snapshot,
          cost_source,
          commission_value
      ),

      -- ------------------------------------------------------------------
      -- 5. Agrega totais dos itens via inserted_items (RETURNING)
      --    total_cost aqui é a soma bruta de total_cost_snapshot — usada
      --    tanto em markup_pct (com total_products) quanto no custo dentro
      --    da fórmula de contribution.
      -- ------------------------------------------------------------------
      item_totals AS (
        SELECT
          ii.order_snapshot_id,
          SUM(ii.quantity)                                          AS items_quantity,
          SUM(ii.total_cost_snapshot)                               AS total_cost,
          SUM(ii.commission_value)                                  AS total_commission,
          BOOL_OR(ii.cost_source IS DISTINCT FROM 'STOCK_AVERAGE') AS has_cost_fallback
        FROM inserted_items ii
        GROUP BY ii.order_snapshot_id
      )

      -- ------------------------------------------------------------------
      -- 6. Atualiza campos derivados no snapshot do pedido
      --
      -- markup_pct: total_products (bruto) vs total_cost (bruto).
      -- contribution_value/contribution_pct: fórmula própria (ver
      -- calculateOrderContributionValueSql) usando tax_commission,
      -- freight_cost, computed_icms_value e total_cost.
      -- total_taxes/total_fees continuam só pra exibição.
      -- ------------------------------------------------------------------
      UPDATE sales_order_snapshots sos
      SET
        items_quantity    = COALESCE(it.items_quantity, 0),
        total_cost        = COALESCE(it.total_cost, 0),
        total_commission  = COALESCE(it.total_commission, 0),

        total_taxes       = ${calculateTotalTaxesSql("sos")},

        total_fees        = ${calculateTotalFeesSql("sos")},

        contribution_value = ${calculateOrderContributionValueSql("sos", snapshotCostSql)},

        contribution_pct  = ${calculateOrderContributionPctSql("sos", snapshotCostSql)},

        markup_pct = ${calculateMarkupSql(snapshotRevenueSql, snapshotCostSql).percent},

        has_cost_fallback = COALESCE(it.has_cost_fallback, FALSE),
        last_updated_at   = NOW(),
        updated_at        = NOW()

      FROM item_totals it
      WHERE sos.id = it.order_snapshot_id
      `,
      { replacements: { orderIds } },
    );
  }

  // ---------------------------------------------------------------------------
  // FUTURO repositories: queries de descoberta das chaves afetadas.
  // ---------------------------------------------------------------------------

  async findAffectedFactKeys(orderIds: string[]): Promise<SalesFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<SalesFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, unit_business_id
      FROM sales_order_snapshots
      WHERE order_id IN (:orderIds)
        AND unit_business_id IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStateFactKeys(
    orderIds: string[],
  ): Promise<SalesStateFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<SalesStateFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, unit_business_id, destination_uf
      FROM sales_order_snapshots
      WHERE order_id IN (:orderIds)
        AND unit_business_id IS NOT NULL
        AND destination_uf IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStoreFactKeys(
    orderIds: string[],
  ): Promise<SalesStoreFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<SalesStoreFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, unit_business_id, store_id
      FROM sales_order_snapshots
      WHERE order_id IN (:orderIds)
        AND unit_business_id IS NOT NULL
        AND store_id IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedProductFactKeys(
    orderIds: string[],
  ): Promise<SalesProductFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<SalesProductFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, unit_business_id, sku
      FROM sales_order_item_snapshots
      WHERE order_id IN (:orderIds)
        AND unit_business_id IS NOT NULL
        AND sku IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStatusFactKeys(
    orderIds: string[],
  ): Promise<SalesStatusFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<SalesStatusFactKey>(
      `
      SELECT DISTINCT
        order_date       AS fact_date,
        unit_business_id,
        integration_id,
        status_snapshot  AS status_normalized
      FROM sales_order_snapshots
      WHERE order_id IN (:orderIds)
        AND unit_business_id IS NOT NULL
        AND status_snapshot IS NOT NULL
      `,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  // ---------------------------------------------------------------------------
  // FUTURO repositories/calculators: materialização das tabelas de facts.
  // ---------------------------------------------------------------------------

  async upsertDailySalesFacts(keys: SalesFactKey[]): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH metrics AS (
          SELECT
            CAST(:factDate AS date)        AS fact_date,
            CAST(:unitBusinessId AS uuid)  AS unit_business_id,
            COUNT(*)::integer              AS orders_count,
            COALESCE(SUM(items_quantity),    0) AS items_quantity,
            -- total_value = receita bruta (total_products), não mais total_order.
            COALESCE(SUM(total_products),    0) AS total_value,
            COALESCE(SUM(freight_cost),   0) AS total_freight,
            COALESCE(SUM(total_cost),        0) AS total_cost,
            COALESCE(SUM(total_taxes),       0) AS total_taxes,
            COALESCE(SUM(total_fees),        0) AS total_fees,
            COALESCE(SUM(total_commission),  0) AS total_commission,
            COALESCE(SUM(contribution_value),0) AS contribution_value
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND ${isCompletedSaleSql("sales_order_snapshots")}
        )
        INSERT INTO daily_sales_facts (
          fact_date, unit_business_id,
          orders_count, items_quantity,
          total_value, total_freight, average_freight, average_ticket,
          total_cost, total_taxes, total_fees, total_commission,
          contribution_value, contribution_pct, markup_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id,
          orders_count, items_quantity,
          total_value, total_freight,
          ${calculateAverageTicketSql("total_freight", "orders_count")},
          ${calculateAverageTicketSql("total_value", "orders_count")},
          total_cost, total_taxes, total_fees, total_commission,
          contribution_value,
          ${calculatePercentageSql("contribution_value", "total_value")},
          ${calculateMarkupSql("total_value", "total_cost").percent},
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id) DO UPDATE SET
          orders_count       = EXCLUDED.orders_count,
          items_quantity     = EXCLUDED.items_quantity,
          total_value        = EXCLUDED.total_value,
          total_freight      = EXCLUDED.total_freight,
          average_freight    = EXCLUDED.average_freight,
          average_ticket     = EXCLUDED.average_ticket,
          total_cost         = EXCLUDED.total_cost,
          total_taxes        = EXCLUDED.total_taxes,
          total_fees         = EXCLUDED.total_fees,
          total_commission   = EXCLUDED.total_commission,
          contribution_value = EXCLUDED.contribution_value,
          contribution_pct   = EXCLUDED.contribution_pct,
          markup_pct         = EXCLUDED.markup_pct,
          last_updated_at    = NOW(),
          updated_at         = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
          },
        },
      );
    }
  }

  async upsertDailySalesStateFacts(keys: SalesStateFactKey[]): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH metrics AS (
          SELECT
            CAST(:factDate AS date)          AS fact_date,
            CAST(:unitBusinessId AS uuid)    AS unit_business_id,
            CAST(:destinationUf AS varchar)  AS destination_uf,
            COUNT(*)::integer                AS orders_count,
            COALESCE(SUM(items_quantity), 0) AS items_quantity,
            -- total_value = receita bruta (total_products), não mais total_order.
            COALESCE(SUM(total_products), 0) AS total_value,
            COALESCE(SUM(freight_cost),0) AS total_freight
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND destination_uf   = :destinationUf
            AND ${isCompletedSaleSql("sales_order_snapshots")}

        )
        INSERT INTO daily_sales_state_facts (
          fact_date, unit_business_id, destination_uf,
          orders_count, items_quantity, total_value,
          total_freight, average_freight, average_ticket,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, destination_uf,
          orders_count, items_quantity, total_value,
          total_freight,
          ${calculateAverageTicketSql("total_freight", "orders_count")},
          ${calculateAverageTicketSql("total_value", "orders_count")},
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id, destination_uf) DO UPDATE SET
          orders_count    = EXCLUDED.orders_count,
          items_quantity  = EXCLUDED.items_quantity,
          total_value     = EXCLUDED.total_value,
          total_freight   = EXCLUDED.total_freight,
          average_freight = EXCLUDED.average_freight,
          average_ticket  = EXCLUDED.average_ticket,
          last_updated_at = NOW(),
          updated_at      = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            destinationUf: key.destination_uf,
          },
        },
      );
    }
  }

  async upsertDailySalesStoreFacts(keys: SalesStoreFactKey[]): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH metrics AS (
          SELECT
            CAST(:factDate AS date)           AS fact_date,
            CAST(:unitBusinessId AS uuid)     AS unit_business_id,
            CAST(:storeId AS uuid)            AS store_id,
            COUNT(*)::integer                 AS orders_count,
            COALESCE(SUM(items_quantity),  0) AS items_quantity,
            -- total_value = receita bruta (total_products), não mais total_order.
            COALESCE(SUM(total_products),  0) AS total_value,
            COALESCE(SUM(freight_cost), 0) AS total_freight,
            COALESCE(SUM(total_cost),      0) AS total_cost,
            COALESCE(SUM(total_taxes),     0) AS total_taxes,
            COALESCE(SUM(total_fees),      0) AS total_fees,
            COALESCE(SUM(total_commission),0) AS total_commission,
            COALESCE(SUM(contribution_value),0) AS contribution_value
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND store_id         = :storeId
            AND ${isCompletedSaleSql("sales_order_snapshots")}
        )
        INSERT INTO daily_sales_store_facts (
          fact_date, unit_business_id, store_id,
          orders_count, items_quantity, total_value, total_freight,
          average_ticket, total_cost, piece_average_value, markup_pct,
          total_taxes, total_fees, total_commission, contribution_value, contribution_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, store_id,
          orders_count, items_quantity, total_value, total_freight,
          ${calculateAverageTicketSql("total_value", "orders_count")},
          total_cost,
          ${calculateAverageValueSql("total_value", "items_quantity")},
          ${calculateMarkupSql("total_value", "total_cost").percent},
          total_taxes, total_fees, total_commission, contribution_value,
          ${calculatePercentageSql("contribution_value", "total_value")},
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id, store_id) DO UPDATE SET
          orders_count        = EXCLUDED.orders_count,
          items_quantity      = EXCLUDED.items_quantity,
          total_value         = EXCLUDED.total_value,
          total_freight       = EXCLUDED.total_freight,
          average_ticket      = EXCLUDED.average_ticket,
          total_cost          = EXCLUDED.total_cost,
          piece_average_value = EXCLUDED.piece_average_value,
          markup_pct          = EXCLUDED.markup_pct,
          total_taxes         = EXCLUDED.total_taxes,
          total_fees          = EXCLUDED.total_fees,
          total_commission    = EXCLUDED.total_commission,
          contribution_value  = EXCLUDED.contribution_value,
          contribution_pct    = EXCLUDED.contribution_pct,
          last_updated_at     = NOW(),
          updated_at          = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            storeId: key.store_id,
          },
        },
      );
    }
  }

  async upsertDailySalesProductFacts(
    keys: SalesProductFactKey[],
  ): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH metrics AS (
          SELECT
            CAST(:factDate AS date)           AS fact_date,
            CAST(:unitBusinessId AS uuid)     AS unit_business_id,
            (ARRAY_AGG(product_id) FILTER (WHERE product_id IS NOT NULL))[1] AS product_id,
            CAST(:sku AS varchar)             AS sku,
            MAX(description)                  AS description,
            COALESCE(SUM(quantity),           0) AS quantity,
            COALESCE(SUM(total_cost_snapshot),0) AS total_cost,
            COALESCE(SUM(commission_value),   0) AS total_commission,
            -- gross_total = quantidade * oi.unit_price, já bruto, sem rateio
            -- do pedido e sem desconto — consistente com a regra de receita
            -- bruta.
            COALESCE(SUM(gross_total),        0) AS total_value
          FROM sales_order_item_snapshots sois
          JOIN sales_order_snapshots sos ON sos.id = sois.order_snapshot_id
  WHERE sois.order_date       = CAST(:factDate AS date)
    AND sois.unit_business_id = :unitBusinessId
    AND sois.sku              = :sku
    AND ${isCompletedSaleSql("sos")}
)
        INSERT INTO daily_sales_product_facts (
          fact_date, unit_business_id, product_id, sku, description,
          quantity, total_cost, total_commission, total_value, markup_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, product_id, sku, description,
          quantity, total_cost, total_commission, total_value,
          ${calculateMarkupSql("total_value", "total_cost").percent},
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id, sku) DO UPDATE SET
          product_id       = EXCLUDED.product_id,
          description      = EXCLUDED.description,
          quantity         = EXCLUDED.quantity,
          total_cost       = EXCLUDED.total_cost,
          total_commission = EXCLUDED.total_commission,
          total_value      = EXCLUDED.total_value,
          markup_pct       = EXCLUDED.markup_pct,
          last_updated_at  = NOW(),
          updated_at       = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            sku: key.sku,
          },
        },
      );
    }
  }

async upsertDailySalesStatusFacts(keys: SalesStatusFactKey[]): Promise<void> {
  if (!keys.length) return;

  const dayKeys = [
    ...new Map(
      keys.map((k) => [
        `${k.fact_date}|${k.unit_business_id}|${k.integration_id}`,
        {
          fact_date: k.fact_date,
          unit_business_id: k.unit_business_id,
          integration_id: k.integration_id,
        },
      ]),
    ).values(),
  ];

  for (const key of dayKeys) {
    // 1. Deleta TODAS as linhas do dia para essa combinação
    await sequelize.query(
      `
      DELETE FROM daily_sales_status_facts
      WHERE fact_date        = CAST(:factDate AS date)
        AND unit_business_id = CAST(:unitBusinessId AS uuid)
        AND integration_id   = CAST(:integrationId AS uuid)
      `,
      {
        replacements: {
          factDate: key.fact_date,
          unitBusinessId: key.unit_business_id,
          integrationId: key.integration_id,
        },
      },
    );

    // 2. Reinsere a partir dos snapshots atuais
    await sequelize.query(
      `
      INSERT INTO daily_sales_status_facts (
        fact_date, unit_business_id, integration_id,
        status_normalized, status_display_name,
        orders_count, total_value,
        last_updated_at, created_at, updated_at
      )
      SELECT
        CAST(:factDate AS date),
        CAST(:unitBusinessId AS uuid),
        CAST(:integrationId AS uuid),
        sos.status_snapshot,
        COALESCE(MAX(iosm.display_name), sos.status_snapshot),
        COUNT(*)::integer,
        -- total_value = receita bruta (total_products), não mais total_order.
        COALESCE(SUM(sos.total_products), 0),
        NOW(), NOW(), NOW()
      FROM sales_order_snapshots sos
      LEFT JOIN integration_order_status_mappings iosm ON (
        iosm.integration_id    = sos.integration_id
        AND iosm.normalized_status = sos.status_snapshot
      )
      WHERE sos.order_date       = CAST(:factDate AS date)
        AND sos.unit_business_id = CAST(:unitBusinessId AS uuid)
        AND sos.integration_id   = CAST(:integrationId AS uuid)
        AND ${hasCompleteCostSql("sos")}
      GROUP BY sos.status_snapshot
      `,
      {
        replacements: {
          factDate: key.fact_date,
          unitBusinessId: key.unit_business_id,
          integrationId: key.integration_id,
        },
      },
    );
  }
}

  // ---------------------------------------------------------------------------
  // FUTURO mappers/utils: consulta e montagem do DTO final do relatório.
  // ---------------------------------------------------------------------------

  async getReport(filters: SalesReportFilters) {
    const replacements = {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      // aceita um array de unit_business_id (vazio/undefined = sem filtro)
      unitBusinessIds: filters.unitBusinessIds ?? [],
      storeId: filters.storeId ?? null,
      state: filters.state ?? null,
      productId: filters.productId ?? null,
      sku: filters.sku ?? null,
      statusNormalized: filters.statusId ?? null,
    };

    // array vazio (ou não informado) = não filtra por unit_business_id
    const unitFilter =
      "(COALESCE(array_length(ARRAY[:unitBusinessIds]::uuid[], 1), 0) = 0 OR unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[]))";

    const [general] = await sequelize.query<ReportRow>(
      `
      SELECT
        COALESCE(SUM(orders_count),    0)::integer AS orders_count,
        COALESCE(SUM(items_quantity),  0) AS items_quantity,
        COALESCE(SUM(total_value),     0) AS total_value,
        COALESCE(SUM(total_freight),   0) AS total_freight,
        -- gross_total: soma do valor bruto + frete + impostos + comissões (visão bruta)
        COALESCE(SUM(total_value), 0) + COALESCE(SUM(total_freight), 0) + COALESCE(SUM(total_taxes), 0) + COALESCE(SUM(total_commission), 0) AS gross_total,
        ${calculateAverageTicketSql("SUM(total_value)", "SUM(orders_count)")} AS average_ticket,
        ${calculateAverageTicketSql("SUM(total_freight)", "SUM(orders_count)")} AS average_freight,
        COALESCE(SUM(total_cost),        0) AS total_cost,
        COALESCE(SUM(total_taxes),       0) AS total_taxes,
        COALESCE(SUM(total_fees),        0) AS total_fees,
        COALESCE(SUM(total_commission),  0) AS total_commission,
        COALESCE(SUM(contribution_value),0) AS contribution_value,
        ${calculatePercentageSql("SUM(contribution_value)", "SUM(total_value)")} AS contribution_pct,
        ${calculateMarkupSql("SUM(total_value)", "SUM(total_cost)").decimal} AS markup_decimal,
        ${calculateMarkupSql("SUM(total_value)", "SUM(total_cost)").percent} AS markup_pct
      FROM daily_sales_facts
      WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
        AND ${unitFilter}
      `,
      { type: QueryTypes.SELECT, replacements },
    );

    const byState = await sequelize.query<ReportRow>(
      `
      SELECT
        destination_uf,
        COALESCE(SUM(orders_count),   0)::integer AS orders_count,
        COALESCE(SUM(items_quantity), 0) AS items_quantity,
        COALESCE(SUM(total_value),    0) AS total_value,
        COALESCE(SUM(total_freight),  0) AS total_freight,
        ${calculateAverageTicketSql("SUM(total_freight)", "SUM(orders_count)")} AS average_freight,
        ${calculateAverageTicketSql("SUM(total_value)", "SUM(orders_count)")} AS average_ticket
      FROM daily_sales_state_facts
      WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
        AND ${unitFilter}
        AND (:state IS NULL OR destination_uf = :state)
      GROUP BY destination_uf
      ORDER BY total_value DESC
      `,
      { type: QueryTypes.SELECT, replacements },
    );

    const byProduct = await sequelize.query<ReportRow>(
      `
    SELECT
      product_id,
      sku,
      MAX(description)          AS description,
      COALESCE(SUM(quantity),   0) AS quantity,
      COALESCE(SUM(total_cost), 0) AS total_cost,
      COALESCE(SUM(total_commission), 0) AS total_commission,
      COALESCE(SUM(total_value),0) AS total_value,
      ${calculateMarkupSql("SUM(total_value)", "SUM(total_cost)").decimal} AS markup_decimal,
      ${calculateMarkupSql("SUM(total_value)", "SUM(total_cost)").percent} AS markup_pct
    FROM daily_sales_product_facts
    WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND ${unitFilter}
      AND (:productId IS NULL OR product_id = CAST(:productId AS uuid))
      AND (:sku IS NULL OR sku = :sku)
    GROUP BY product_id, sku
    ORDER BY quantity DESC
    `,
      { type: QueryTypes.SELECT, replacements },
    );

    const byUnitBusiness = await sequelize.query<ReportRow>(
      `
    SELECT
      dsf.unit_business_id,
      ub.name                                       AS unit_business_name,
      COALESCE(SUM(dsf.orders_count),       0)::integer AS orders_count,
      COALESCE(SUM(dsf.items_quantity),     0) AS items_quantity,
      COALESCE(SUM(dsf.total_value),        0) AS total_value,
      COALESCE(SUM(dsf.total_freight),      0) AS total_freight,
      ${calculateAverageTicketSql("SUM(dsf.total_value)", "SUM(dsf.orders_count)")} AS average_ticket,
      COALESCE(SUM(dsf.total_cost),         0) AS total_cost,
      ${calculateAverageValueSql("SUM(dsf.total_value)", "SUM(dsf.items_quantity)")} AS piece_average_value,
      ${calculateMarkupSql("SUM(dsf.total_value)", "SUM(dsf.total_cost)").decimal} AS markup_decimal,
      ${calculateMarkupSql("SUM(dsf.total_value)", "SUM(dsf.total_cost)").percent} AS markup_pct,
      COALESCE(SUM(dsf.total_taxes),        0) AS total_taxes,
      COALESCE(SUM(dsf.total_fees),         0) AS total_fees,
      COALESCE(SUM(dsf.total_commission),   0) AS total_commission,
      COALESCE(SUM(dsf.contribution_value), 0) AS contribution_value,
      ${calculatePercentageSql("SUM(dsf.contribution_value)", "SUM(dsf.total_value)")} AS contribution_pct
    FROM daily_sales_facts dsf
    LEFT JOIN unit_businesses ub ON ub.id = dsf.unit_business_id
    WHERE dsf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND (
        COALESCE(array_length(ARRAY[:unitBusinessIds]::uuid[], 1), 0) = 0
        OR dsf.unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[])
      )
    GROUP BY dsf.unit_business_id, ub.name
    ORDER BY total_value DESC
    `,
      { type: QueryTypes.SELECT, replacements },
    );

    const byStatus = await sequelize.query<ReportRow>(
      `
    WITH total AS (
      SELECT COALESCE(SUM(orders_count), 0)::integer AS orders_count
      FROM daily_sales_status_facts
      WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
        AND ${unitFilter}
    )
    SELECT
      dssf.status_normalized,
      COALESCE(
        MAX(iosm.display_name),
        MAX(dssf.status_display_name),
        dssf.status_normalized
      )                                              AS status_display_name,
      COALESCE(SUM(dssf.orders_count), 0)::integer  AS orders_count,
      total.orders_count                            AS total_orders_count,
      COALESCE(SUM(dssf.total_value),  0)           AS total_value
    FROM daily_sales_status_facts dssf
    CROSS JOIN total
    LEFT JOIN integration_order_status_mappings iosm 
  ON iosm.normalized_status = dssf.status_normalized
    WHERE dssf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND (
        COALESCE(array_length(ARRAY[:unitBusinessIds]::uuid[], 1), 0) = 0
        OR dssf.unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[])
      )
      AND (:statusNormalized IS NULL OR dssf.status_normalized = :statusNormalized)
    GROUP BY dssf.status_normalized, total.orders_count
    ORDER BY orders_count DESC
    `,
      { type: QueryTypes.SELECT, replacements },
    );

    return {
      period: {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      },
      general: general ?? {},
      byState,
      byProduct,
      byUnitBusiness,
      byStatus,
    };
  }

  /**
   * FUTURO repositories/calculators:
   * Este método recalcula totais derivados quando o snapshot de item já existe.
   * Ele usa os mesmos calculators SQL do upsert principal, então mudanças em
   * lucro, margem/markup, impostos ou taxas passam por um único ponto.
   *
   * computed_icms_value já está persistido no snapshot do pedido (calculado
   * em upsertSnapshots via join com states) — aqui só lemos a coluna, não
   * recalculamos a alíquota.
   */
  async updateSnapshotTotals(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    const snapshotCostSql = "it.total_cost";

    await sequelize.query(
      `
    WITH item_totals AS (
      SELECT
        sois.order_snapshot_id,
        SUM(sois.quantity)                                           AS items_quantity,
        SUM(sois.total_cost_snapshot)                                AS total_cost,
        SUM(sois.commission_value)                                   AS total_commission,
        BOOL_OR(sois.cost_source IS DISTINCT FROM 'STOCK_AVERAGE')  AS has_cost_fallback
      FROM sales_order_item_snapshots sois
      WHERE sois.order_id IN (:orderIds)
      GROUP BY sois.order_snapshot_id
    )
    UPDATE sales_order_snapshots sos
    SET
      items_quantity    = COALESCE(it.items_quantity, 0),
      total_cost        = COALESCE(it.total_cost, 0),
      total_commission  = COALESCE(it.total_commission, 0),

      total_taxes       = ${calculateTotalTaxesSql("sos")},

      total_fees        = ${calculateTotalFeesSql("sos")},

      contribution_value = ${calculateOrderContributionValueSql("sos", snapshotCostSql)},

      contribution_pct  = ${calculateOrderContributionPctSql("sos", snapshotCostSql)},

      markup_pct = ${calculateMarkupSql("sos.total_products", snapshotCostSql).percent},

      has_cost_fallback = COALESCE(it.has_cost_fallback, FALSE),
      last_updated_at   = NOW(),
      updated_at        = NOW()

    FROM item_totals it
    WHERE sos.id = it.order_snapshot_id
    `,
      { replacements: { orderIds } },
    );
  }

  async getJobStatus() {
    const rows = await sequelize.query<{
      status: string;
      last_run_at: Date;
      last_processed_at: Date;
      rows_processed: number;
      metadata: { error?: string } | null;
    }>(
      `
    SELECT status, last_run_at, last_processed_at, rows_processed, metadata
    FROM report_job_checkpoints
    WHERE job_name = :jobName
    LIMIT 1
    `,
      { type: QueryTypes.SELECT, replacements: { jobName: JOB_NAME } },
    );

    return rows[0] ?? null;
  }
}

export const salesReportRepository = new SalesReportRepository();