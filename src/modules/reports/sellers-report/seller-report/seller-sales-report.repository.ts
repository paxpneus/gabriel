//seller report
import { QueryTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  AffectedSellerCustomerFactKey,
  AffectedSellerProductFactKey,
  OrderIdRow,
  SellerSalesReportFilters,
} from "./seller-sales-report.types";

const JOB_NAME = "seller_sales_report";

// Mesma unit_business "de custo" usada em sales_report — é onde os
// stock_movements de referência (custo médio real) são resolvidos,
// independente da unit_business em que o pedido foi vendido.
const STOCK_MOVEMENTS_UNIT_BUSINESS_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

/**
 * =====================================================================
 * ALINHAMENTO COM sales_report (revisão desta versão)
 * =====================================================================
 * Esta versão troca a lógica de cálculo financeiro deste repository para
 * ser EXATAMENTE a mesma usada em sales_report (sales-report.repository.ts).
 * A ÚNICA diferença de comportamento entre os dois relatórios continua
 * sendo o filtro de vendedor: aqui só entram itens de pedidos cujo
 * vendedor (contacts.name) é DIFERENTE de 'Vendedor 0' (marketplace).
 * Fora isso, todas as regras abaixo são idênticas às de sales_report:
 *
 * 1. Receita bruta: SEMPRE orders.total_products. Nunca orders.total_price
 *    e nunca nada líquido de tax_commission/freight_cost/ICMS. É a base de
 *    markup, do rateio de item (net_total_allocated) e de contribution.
 *
 * 2. Custo do item (revisão desta versão — igual a sales_report revisão 3):
 *    average_cost_snapshot NÃO vem mais de order_items — é resolvido em
 *    tempo real, por item, a partir de stock_movements: pegamos o
 *    resulting_average_cost do stock_movement de mesmo product_id +
 *    unit_business_id = STOCK_MOVEMENTS_UNIT_BUSINESS_ID cujo movement_date
 *    seja o mais próximo, igual ou anterior à data do pedido (empate de
 *    data+hora desempatado por created_at mais recente).
 *
 *    KIT: se o SKU vendido tem sufixo Kn (ex: "ABC123K4"), o custo médio é
 *    resolvido a partir do produto UNITÁRIO (SKU sem o sufixo, buscado em
 *    product_configs na mesma STOCK_MOVEMENTS_UNIT_BUSINESS_ID) e depois
 *    multiplicado por N (kit_multiplier) — exatamente a mesma regra usada
 *    em sales_report.
 *
 *    total_cost do item = average_cost_snapshot(stock_movements) * quantity
 *    + commission_value. order_items.total_cost_snapshot/average_cost_snapshot
 *    (gravados por outras integrações, ex: BlingOrderService) DEIXARAM de
 *    ser fonte de verdade para este relatório — não há mais fallback para
 *    eles.
 *
 * 3. ICMS: não usamos mais orders.icms_value (nota fiscal) para ratear.
 *    Usamos o MESMO cálculo de sales_report — computed_icms_value =
 *    (total_products - discount_value) * (states.icms_rate / 100), com
 *    a alíquota resolvida via states.acronym = orders.destination_uf.
 *    Esse valor é calculado no nível do pedido e rateado por item pelo
 *    mesmo item_weight usado para ratear a receita.
 *
 * 4. Contribution (lucro real): ÚNICO lugar onde tax_commission,
 *    freight_cost e o ICMS computado entram na conta — exatamente como em
 *    sales_report, só que aqui rateados por item (pois esta tabela é por
 *    item, enquanto sales_report só calcula contribution no nível do
 *    pedido). Por item:
 *
 *      contribution_value = net_total_allocated
 *                            - tax_commission_allocated
 *                            - freight_cost_allocated
 *                            - icms_value_allocated
 *                            - total_cost (produto, sem ICMS)
 *
 *    Somando os itens de um mesmo pedido, contribution_value bate
 *    exatamente com a fórmula de contribution de sales_report para aquele
 *    pedido, pois todos os componentes são rateados pelo mesmo peso e a
 *    soma dos pesos de um pedido é sempre 1.
 *
 * 5. Peso do item (item_weight): idêntico a sales_report — net_total_raw
 *    do item (valor bruto vindo da Bling, só para peso) dividido pela soma
 *    de net_total_raw de todos os itens do pedido.
 *
 * 6. Validade da venda (is_valid_sale — revisão desta versão): antes essa
 *    checagem usava um CASE em order_source baseado em
 *    order_items.average_cost_snapshot (a coluna antiga, gravada por outra
 *    integração). Como o custo agora é resolvido por item via
 *    stock_movements, essa checagem deixou de ser confiável e foi movida
 *    para dentro de item_metrics: is_valid_sale só é TRUE quando (a) o
 *    pedido está com actual_situation IN ('6','9') E (b) TODOS os itens do
 *    pedido têm average_cost_snapshot(stock_movements) > 0 — verificado via
 *    BOOL_AND(...) OVER (PARTITION BY order_id), equivalente ao
 *    hasCompleteCostSql de sales_report (que confere o custo já resolvido
 *    de cada item, não um flag prévio).
 *
 * 7. Comissão de vendedor (commission_value) e de gerente
 *    (manager_commission_value): não fazem parte da lógica de sales_report
 *    (são específicas deste relatório) e permanecem como antes — comissão
 *    de vendedor vem por item de order_items; comissão de gerente é
 *    net_total_allocated * manager_commission_rate / 100.
 *
 * ATENÇÃO / MIGRAÇÃO NECESSÁRIA (mantida de revisão anterior):
 * Esta versão grava tax_commission_allocated e freight_cost_allocated por
 * item (necessários para reproduzir a fórmula de contribution acima no
 * nível do item). Se essas colunas ainda não existirem em
 * `seller_sales_order_item_snapshots`, é necessário criar uma migration
 * adicionando:
 *   - tax_commission_allocated numeric NOT NULL DEFAULT 0
 *   - freight_cost_allocated   numeric NOT NULL DEFAULT 0
 * `total_cost` passa a significar APENAS custo de produto (sem ICMS).
 *
 * NOTA (mantida): existe no banco uma tabela `sales_order_item_snapshots`
 * que pertence ao OUTRO relatório (sales_report). Este job usa sua PRÓPRIA
 * tabela, `seller_sales_order_item_snapshots`. Não confundir as duas.
 */

interface CheckpointRow {
  last_processed_at: Date;
}

type SqlExpression = string;

// ---------------------------------------------------------------------
// Calculators SQL — cópia fiel dos helpers de sales_report. Mantidos
// duplicados aqui (em vez de importados) para não acoplar os dois
// repositories; qualquer mudança de regra deve ser replicada nos dois
// arquivos até que exista um módulo compartilhado de calculators.
// ---------------------------------------------------------------------
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
): SqlExpression =>
  `${coalesceNumberSql(revenue)} - ${coalesceNumberSql(cost)}`;

const calculatePercentageSql = (
  numerator: SqlExpression,
  denominator: SqlExpression,
): SqlExpression =>
  calculateSafeDivisionSql(`(${numerator}) * 100`, denominator, 2);

const calculateAverageTicketSql = (
  totalRevenue: SqlExpression,
  totalOrders: SqlExpression,
): SqlExpression => calculateSafeDivisionSql(totalRevenue, totalOrders, 2);

const calculateMarkupSql = (
  revenue: SqlExpression,
  cost: SqlExpression,
): { decimal: SqlExpression; percent: SqlExpression } => {
  const profit = calculateProfitSql(revenue, cost);

  return {
    decimal: calculateSafeDivisionSql(profit, cost, 4),
    percent: calculatePercentageSql(profit, cost),
  };
};

export class SellerSalesReportRepository {
  async getCheckpoint(): Promise<Date> {
    await this.ensureCheckpoint();

    const rows = await sequelize.query<CheckpointRow>(
      `
      SELECT last_processed_at
      FROM report_job_checkpoints
      WHERE job_name = :jobName
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { jobName: JOB_NAME },
      },
    );

    if (!rows[0]) {
      throw new Error(
        "Não foi possível inicializar o checkpoint seller_sales_report.",
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
    await sequelize.query(
      `
      UPDATE report_job_checkpoints
      SET status = 'running',
          last_run_at = NOW(),
          updated_at = NOW()
      WHERE job_name = :jobName
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
        replacements: {
          jobName: JOB_NAME,
          jobStartTime,
          rowsProcessed,
        },
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

  /**
   * Fontes de alteração: idêntico a sales_report — apenas orders e
   * order_items.
   */
  async findAffectedOrderIds(lastProcessedAt: Date): Promise<string[]> {
    const rows: OrderIdRow[] = await sequelize.query<OrderIdRow>(
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
      {
        type: QueryTypes.SELECT,
        replacements: { lastProcessedAt },
      },
    );

    return rows.map((row) => row.order_id);
  }

  async upsertSnapshots(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    // Custo do item: SEMPRE average_cost_snapshot (resolvido via
    // stock_movements, com resolução de KIT pelo produto unitário) *
    // quantity + commission_value. Sem fallback para o total_cost_snapshot
    // pré-gravado em order_items — idêntico a sales_report revisão 3.
    // NUNCA soma ICMS aqui.
    const itemCostSql =
      "ROUND((average_cost_snapshot * quantity)::numeric, 2) + commission_value";

    await sequelize.query(
      `
      WITH affected(order_id) AS (
        SELECT DISTINCT unnest(ARRAY[:orderIds]::uuid[])
      ),

      -- ------------------------------------------------------------------
      -- 1. Fonte de dados do pedido — mesma base de sales_report:
      --    join com states para resolver a alíquota de ICMS do destino e
      --    calcular computed_icms_value = (total_products - discount_value)
      --    * icms_rate. Filtro de vendedor (única diferença deste
      --    relatório): só entram pedidos cujo contacts.name é diferente de
      --    'Vendedor 0'.
      --
      --    snapshot_status aqui reflete SOMENTE o status do pedido
      --    (completed/cancelled pela actual_situation) — a checagem de
      --    custo completo NÃO é mais feita aqui (ver item_metrics), pois o
      --    custo agora é resolvido por item via stock_movements, não mais
      --    lido de order_items.average_cost_snapshot.
      -- ------------------------------------------------------------------
        order_source AS (
        SELECT
          o.id                        AS order_id,
          o.seller_id,
          o.customer_id,
          o.unit_business_id,
          DATE(COALESCE(o.date, o.created_at)) AS order_date,
          o.destination_uf,
          COALESCE(o.total_products, 0)  AS total_products,
          COALESCE(o.discount_value, 0)  AS discount_value,
          COALESCE(o.tax_commission, 0)  AS tax_commission,
          CASE
            WHEN ub.name = 'Shopee' THEN 0
            ELSE COALESCE(o.freight_cost, 0)
          END                              AS freight_cost,
          CASE
           WHEN o.internal_status IN ('OPEN', 'EMITTED', 'SENT_TO_TRANSPORTER', 'DELIVERED') THEN 'completed'
            ELSE 'cancelled'
          END AS snapshot_status,
          ROUND(
            (COALESCE(o.total_products, 0) - COALESCE(o.discount_value, 0))
            * (COALESCE(st.icms_rate, 0) / 100),
            2
          ) AS computed_icms_value
             FROM orders o
JOIN affected a ON a.order_id = o.id
LEFT JOIN states st ON st.acronym = o.destination_uf
LEFT JOIN contacts sc ON sc.id = o.seller_id
LEFT JOIN unit_businesses ub ON ub.id = o.unit_business_id
WHERE o.seller_id IS NOT NULL
  AND COALESCE(sc.name, '') <> 'Vendedor 0'
  AND COALESCE(ub.number::varchar, '') <> '0'

      ),

      -- ------------------------------------------------------------------
      -- 2. Fonte de dados dos itens (valores brutos do item, ainda sem
      --    ratear nada do pedido — net_total_raw só serve para calcular o
      --    peso do item). average_cost_snapshot agora é resolvido via
      --    stock_movements (com resolução de KIT), exatamente igual a
      --    sales_report: pegamos o sku efetivo (product_configs ou o sku
      --    do próprio order_item), detectamos sufixo Kn para achar o
      --    kit_multiplier e o sku unitário, resolvemos o product_id de
      --    custo (unitário, se for kit) via product_configs na
      --    STOCK_MOVEMENTS_UNIT_BUSINESS_ID, e então buscamos o
      --    resulting_average_cost do stock_movement mais próximo, igual ou
      --    anterior à data do pedido para esse produto nessa unit_business.
      -- ------------------------------------------------------------------
      item_source_raw AS (
        SELECT
          oi.id                              AS order_item_id,
          oi.order_id,
          os.seller_id,
          os.customer_id,
          COALESCE(oi.product_id, p.id)      AS product_id,
          os.unit_business_id,
          os.order_date,
          os.destination_uf,
          p.name    AS product_name,
          p.brand   AS product_brand,
          p.measure AS product_measure,
          COALESCE(oi.quantity, 0)::numeric      AS quantity,
          COALESCE(oi.unit_price, oi.price, 0)::numeric AS unit_price,
          COALESCE(
            oi.net_total,
            COALESCE(oi.gross_total, (COALESCE(oi.unit_price, oi.price, 0)::numeric * COALESCE(oi.quantity, 0)::numeric))
          )::numeric AS net_total_raw,

          -- KIT: mesma regra de sales_report (/K(\\d+)$/i no sku efetivo).
          -- kit_multiplier = quantas unidades reais tem 1 kit.
          COALESCE(
            (regexp_match(COALESCE(pc.sku, oi.sku), 'K([0-9]+)$', 'i'))[1]::int,
            1
          ) AS kit_multiplier,

          -- average_cost_snapshot = custo médio unitário (via
          -- stock_movements do produto certo — UNIT se for kit, o próprio
          -- se não for) × kit_multiplier. Se não existir stock_movement
          -- anterior/igual à data do pedido, fica 0 (mesma regra de "custo
          -- ausente" de sales_report).
          COALESCE(scm.resulting_average_cost, 0)::numeric
            * COALESCE(
                (regexp_match(COALESCE(pc.sku, oi.sku), 'K([0-9]+)$', 'i'))[1]::int,
                1
              ) AS average_cost_snapshot,

          COALESCE(oi.commission_base, 0)::numeric  AS commission_base,
          COALESCE(oi.commission_rate, 0)::numeric  AS commission_rate,
          COALESCE(oi.commission_value, 0)::numeric AS commission_value,
          COALESCE(oi.comission_manager_rate, 0)::numeric AS manager_commission_rate,
          os.total_products     AS order_total_products,
          os.tax_commission     AS order_tax_commission,
          os.freight_cost       AS order_freight_cost,
          os.computed_icms_value AS order_computed_icms_value,
          os.snapshot_status
        FROM order_items oi
        JOIN order_source os ON os.order_id = oi.order_id
        JOIN orders ord ON ord.id = oi.order_id

        LEFT JOIN product_configs pc_by_sku ON (
          oi.product_id IS NULL
          AND pc_by_sku.sku = oi.sku
          AND pc_by_sku.unit_business_id = os.unit_business_id
        )
        LEFT JOIN products p ON (
          p.id = oi.product_id
          OR p.id = pc_by_sku.product_id
        )
        LEFT JOIN product_configs pc ON (
          pc.product_id = COALESCE(oi.product_id, p.id)
          AND pc.unit_business_id = os.unit_business_id
        )

        -- Resolve o product_id "de custo": se o item vendido é KIT (sku com
        -- sufixo Kn), busca o product_config do produto UNITÁRIO (sku sem o
        -- sufixo) no MESMO unit_business usado para achar stock_movements.
        -- Se não for kit, mantém o product_id original.
        LEFT JOIN LATERAL (
          SELECT pc_unit.product_id
          FROM product_configs pc_unit
          WHERE pc_unit.unit_business_id = :stockUnitBusinessId
            AND pc_unit.sku = regexp_replace(COALESCE(pc.sku, oi.sku), 'K[0-9]+$', '', 'i')
          LIMIT 1
        ) pc_unit_lookup ON (
          regexp_match(COALESCE(pc.sku, oi.sku), 'K([0-9]+)$', 'i') IS NOT NULL
        )

        LEFT JOIN LATERAL (
          SELECT sm.resulting_average_cost
          FROM stock_movements sm
          WHERE sm.product_id = COALESCE(pc_unit_lookup.product_id, oi.product_id, p.id)
            AND sm.unit_business_id = :stockUnitBusinessId
            AND sm.movement_date <= COALESCE(ord.date, ord.created_at)
          ORDER BY sm.movement_date DESC, sm.created_at DESC
          LIMIT 1
        ) scm ON TRUE
      ),

      -- ------------------------------------------------------------------
      -- 3. Peso do item dentro do pedido — idêntico a sales_report.
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
      -- 4. Rateio: receita (total_products), ICMS computado, tax_commission
      --    e freight_cost são distribuídos entre os itens proporcionalmente
      --    ao item_weight — mesma mecânica de rateio de sales_report,
      --    estendida para permitir contribution por item (sales_report só
      --    calcula contribution no nível do pedido, pois não é por item).
      -- ------------------------------------------------------------------
      item_calc AS (
        SELECT
          *,
          ROUND(item_weight * order_total_products, 2)      AS net_total_allocated,
          ROUND(item_weight * order_computed_icms_value, 2) AS icms_value_allocated,
          ROUND(item_weight * order_tax_commission, 2)      AS tax_commission_allocated,
          ROUND(item_weight * order_freight_cost, 2)        AS freight_cost_allocated
        FROM item_weighted
      ),

      -- ------------------------------------------------------------------
      -- 5. Métricas finais do item. total_cost = SOMENTE custo de produto
      --    (sem ICMS), idêntico a sales_report. Contribution é o único
      --    lugar que soma tax_commission_allocated + freight_cost_allocated
      --    + icms_value_allocated, também idêntico a sales_report.
      --
      --    is_valid_sale (revisão desta versão): TRUE apenas quando o
      --    pedido está 'completed' E TODOS os itens do pedido têm
      --    average_cost_snapshot > 0 — checagem autoritativa feita aqui via
      --    BOOL_AND(...) OVER (PARTITION BY order_id), pois o custo agora é
      --    resolvido por item via stock_movements (equivalente ao
      --    hasCompleteCostSql de sales_report, que também confere o custo
      --    já resolvido, não um flag prévio do pedido).
      -- ------------------------------------------------------------------
            item_metrics AS (
        SELECT
          *,
          ${itemCostSql} AS total_cost,
          (average_cost_snapshot > 0) AS has_cost_data,
          (
            snapshot_status = 'completed'
            AND BOOL_AND(average_cost_snapshot > 0) OVER (PARTITION BY order_id)
          ) AS is_valid_sale,
          ROUND(net_total_allocated * manager_commission_rate / 100, 2) AS manager_commission_value
        FROM item_calc
      )

      INSERT INTO seller_sales_order_item_snapshots (
        order_item_id, order_id, seller_id, customer_id, product_id, unit_business_id,
        order_date, product_name, product_brand, product_measure,
        quantity, unit_price, net_total, average_cost, total_cost, has_cost_data,
        icms_value_allocated, tax_commission_allocated, freight_cost_allocated,
        commission_base, commission_rate, commission_value,
        manager_commission_rate, manager_commission_value,
        markup_value, markup_pct,
        contribution_value, contribution_pct, is_valid_sale,
        last_updated_at, created_at, updated_at
      )
      SELECT
        order_item_id, order_id, seller_id, customer_id, product_id, unit_business_id,
        order_date, product_name, product_brand, product_measure,
        quantity, unit_price,
        net_total_allocated AS net_total,
        average_cost_snapshot AS average_cost,
        total_cost,
        has_cost_data,
        icms_value_allocated, tax_commission_allocated, freight_cost_allocated,
        commission_base, commission_rate, commission_value,
        manager_commission_rate, manager_commission_value,
        (net_total_allocated - total_cost) AS markup_value,
        ${calculateMarkupSql("net_total_allocated", "total_cost").percent} AS markup_pct,
        (net_total_allocated - tax_commission_allocated - freight_cost_allocated - icms_value_allocated - total_cost) AS contribution_value,
        ${calculatePercentageSql(
          "net_total_allocated - tax_commission_allocated - freight_cost_allocated - icms_value_allocated - total_cost",
          "net_total_allocated",
        )} AS contribution_pct,
        is_valid_sale,
        NOW(), NOW(), NOW()
      FROM item_metrics
      ON CONFLICT (order_item_id) DO UPDATE SET
        seller_id                  = EXCLUDED.seller_id,
        customer_id                = EXCLUDED.customer_id,
        product_id                 = EXCLUDED.product_id,
        unit_business_id           = EXCLUDED.unit_business_id,
        order_date                 = EXCLUDED.order_date,
        product_name               = EXCLUDED.product_name,
        product_brand              = EXCLUDED.product_brand,
        product_measure            = EXCLUDED.product_measure,
        quantity                   = EXCLUDED.quantity,
        unit_price                 = EXCLUDED.unit_price,
        net_total                  = EXCLUDED.net_total,
        average_cost               = EXCLUDED.average_cost,
        total_cost                 = EXCLUDED.total_cost,
        has_cost_data              = EXCLUDED.has_cost_data,
        icms_value_allocated       = EXCLUDED.icms_value_allocated,
        tax_commission_allocated   = EXCLUDED.tax_commission_allocated,
        freight_cost_allocated     = EXCLUDED.freight_cost_allocated,
        commission_base            = EXCLUDED.commission_base,
        commission_rate            = EXCLUDED.commission_rate,
        commission_value           = EXCLUDED.commission_value,
        manager_commission_rate    = EXCLUDED.manager_commission_rate,
        manager_commission_value   = EXCLUDED.manager_commission_value,
        markup_value               = EXCLUDED.markup_value,
        markup_pct                 = EXCLUDED.markup_pct,
        contribution_value         = EXCLUDED.contribution_value,
        contribution_pct           = EXCLUDED.contribution_pct,
        is_valid_sale               = EXCLUDED.is_valid_sale,
        last_updated_at            = NOW(),
        updated_at                 = NOW()
      `,
      {
        replacements: {
          orderIds,
          stockUnitBusinessId: STOCK_MOVEMENTS_UNIT_BUSINESS_ID,
        },
      },
    );
  }

  async findAffectedSellerProductFactKeys(
    orderIds: string[],
  ): Promise<AffectedSellerProductFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<AffectedSellerProductFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, seller_id, product_id
      FROM seller_sales_order_item_snapshots
      WHERE order_id IN (:orderIds)
        AND order_date IS NOT NULL
        AND seller_id IS NOT NULL
        AND product_id IS NOT NULL
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { orderIds },
      },
    );
  }

  async findAffectedSellerCustomerFactKeys(
    orderIds: string[],
  ): Promise<AffectedSellerCustomerFactKey[]> {
    if (!orderIds.length) return [];

    return sequelize.query<AffectedSellerCustomerFactKey>(
      `
      SELECT DISTINCT order_date AS fact_date, seller_id, customer_id
      FROM seller_sales_order_item_snapshots
      WHERE order_id IN (:orderIds)
        AND order_date IS NOT NULL
        AND seller_id IS NOT NULL
        AND customer_id IS NOT NULL
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { orderIds },
      },
    );
  }

  async upsertDailySellerProductFacts(
    keys: AffectedSellerProductFactKey[],
  ): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH agg AS (
          SELECT
            CAST(:factDate AS date) AS fact_date,
            CAST(:sellerId AS uuid) AS seller_id,
            CAST(:productId AS uuid) AS product_id,
            MAX(product_name) AS product_name,
            MAX(product_brand) AS product_brand,
            MAX(product_measure) AS product_measure,
            COALESCE(SUM(quantity), 0)::integer AS quantity_sold,
            COUNT(DISTINCT order_id)::integer AS orders_count,
            COALESCE(SUM(net_total), 0) AS total_sold,
            -- total_cost agora é SOMENTE custo de produto (sem ICMS),
            -- idêntico à regra de custo de sales_report.
            COALESCE(SUM(total_cost), 0) AS total_cost,
            COALESCE(SUM(commission_value), 0) AS total_commission,
            COALESCE(SUM(markup_value), 0) AS total_markup_value,
            COALESCE(SUM(contribution_value), 0) AS total_contribution_value
          FROM seller_sales_order_item_snapshots
          WHERE order_date = CAST(:factDate AS date)
            AND seller_id = CAST(:sellerId AS uuid)
            AND product_id = CAST(:productId AS uuid)
            AND is_valid_sale = TRUE
        )
        INSERT INTO daily_seller_product_facts (
          fact_date,
          seller_id,
          product_id,
          product_name,
          product_brand,
          product_measure,
          quantity_sold,
          orders_count,
          total_sold,
          total_cost,
          total_commission,
          total_markup_value,
          total_contribution_value,
          last_updated_at,
          created_at,
          updated_at
        )
        SELECT
          fact_date,
          seller_id,
          product_id,
          product_name,
          product_brand,
          product_measure,
          quantity_sold,
          orders_count,
          total_sold,
          total_cost,
          total_commission,
          total_markup_value,
          total_contribution_value,
          NOW(),
          NOW(),
          NOW()
        FROM agg
        ON CONFLICT (fact_date, seller_id, product_id) DO UPDATE SET
          product_name              = EXCLUDED.product_name,
          product_brand             = EXCLUDED.product_brand,
          product_measure           = EXCLUDED.product_measure,
          quantity_sold              = EXCLUDED.quantity_sold,
          orders_count               = EXCLUDED.orders_count,
          total_sold                 = EXCLUDED.total_sold,
          total_cost                 = EXCLUDED.total_cost,
          total_commission           = EXCLUDED.total_commission,
          total_markup_value         = EXCLUDED.total_markup_value,
          total_contribution_value   = EXCLUDED.total_contribution_value,
          last_updated_at            = NOW(),
          updated_at                 = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            sellerId: key.seller_id,
            productId: key.product_id,
          },
        },
      );
    }
  }

  async upsertDailySellerCustomerFacts(
    keys: AffectedSellerCustomerFactKey[],
  ): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH agg AS (
          SELECT
            CAST(:factDate AS date) AS fact_date,
            CAST(:sellerId AS uuid) AS seller_id,
            CAST(:customerId AS uuid) AS customer_id,
            COUNT(DISTINCT s.order_id)::integer AS orders_count,
            COALESCE(SUM(s.net_total), 0) AS total_purchased,
            COALESCE(SUM(s.commission_value), 0) AS total_commission,
            MAX(c.name) AS customer_name
          FROM seller_sales_order_item_snapshots s
          LEFT JOIN customers c ON c.id = s.customer_id
          WHERE s.order_date = CAST(:factDate AS date)
            AND s.seller_id = CAST(:sellerId AS uuid)
            AND s.customer_id = CAST(:customerId AS uuid)
            AND s.is_valid_sale = TRUE
        )
        INSERT INTO daily_seller_customer_facts (
          fact_date,
          seller_id,
          customer_id,
          customer_name,
          orders_count,
          total_purchased,
          total_commission,
          last_updated_at,
          created_at,
          updated_at
        )
        SELECT
          fact_date,
          seller_id,
          customer_id,
          customer_name,
          orders_count,
          total_purchased,
          total_commission,
          NOW(),
          NOW(),
          NOW()
        FROM agg
        ON CONFLICT (fact_date, seller_id, customer_id) DO UPDATE SET
          customer_name      = EXCLUDED.customer_name,
          orders_count        = EXCLUDED.orders_count,
          total_purchased     = EXCLUDED.total_purchased,
          total_commission    = EXCLUDED.total_commission,
          last_updated_at     = NOW(),
          updated_at          = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            sellerId: key.seller_id,
            customerId: key.customer_id,
          },
        },
      );
    }
  }
  
  /**
 * Resolve o escopo de acesso a partir do userId:
 * - type === 'seller': restringe a UM seller_id (o contact do próprio user,
 *   onde contacts.type = 'seller') e à unit_business do usuário
 *   (users.unit_business_id — a "casa" do user, não main_unit_business_id,
 *   que é usado especificamente para managers).
 * - type === 'manager': restringe apenas à unit_business do usuário
 *   (main_unit_business_id — mesma coluna já usada em byManager — com
 *   fallback pra unit_business_id caso main_unit_business_id seja NULL).
 * - qualquer outro type (ou sem userId): sem restrição adicional, filtro
 *   padrão de sempre.
 *
 * Retorna null quando não há restrição a aplicar.
 */

  private async resolveUserScope(
  userId: string,
): Promise<{ sellerId: string | null; unitBusinessId: string | null } | null> {
  const [row] = await sequelize.query<{
    user_id: string;
    unit_business_id: string;
    main_unit_business_id: string | null;
    config_type: string | null;
    contact_id: string | null;
  }>(
    `
    SELECT
      u.id                     AS user_id,
      u.unit_business_id       AS unit_business_id,
      u.main_unit_business_id  AS main_unit_business_id,
      uc.type                  AS config_type,
      c.id                     AS contact_id
    FROM users u
    LEFT JOIN user_config uc ON uc.user_id = u.id
    LEFT JOIN contacts c ON c.user_id = u.id AND c.type = 'SELLER'
    WHERE u.id = :userId
    LIMIT 1
    `,
    { type: QueryTypes.SELECT, replacements: { userId } },
  );

  if (!row) return null;

  if (row.config_type === "seller") {
    return {
      sellerId: row.contact_id ?? "00000000-0000-0000-0000-000000000000",
      unitBusinessId: row.unit_business_id,
    };
  }

  if (row.config_type === "manager") {
    return {
      sellerId: null,
      unitBusinessId: row.main_unit_business_id,
    };
  }

  // type padrão/standard/desconhecido: sem restrição
  return null;
}

async getReport(filters: SellerSalesReportFilters) {
  const userScope = filters.userId
    ? await this.resolveUserScope(filters.userId)
    : null;

  const toArray = (values?: string[] | null): string[] =>
    values && values.length ? values : [];

  // Escopo do usuário (seller/manager) tem prioridade e força um único id,
  // ignorando o array vindo dos filtros.
  const sellerIds = userScope?.sellerId
    ? [userScope.sellerId]
    : toArray(filters.sellerIds);

  const unitBusinessIds = userScope?.unitBusinessId
    ? [userScope.unitBusinessId]
    : toArray(filters.unitBusinessIds);

 const baseFilterReplacements = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    sellerIds,
    productIds: toArray(filters.productIds),
    brandIds: toArray(filters.brandIds),
    tireMeasure: filters.tireMeasure ?? null,
    customerIds: toArray(filters.customerIds),
    unitBusinessIds,
  };

  // -------------------------------------------------------------
  // report_rows: todos os filtros de "único valor" viraram arrays.
  // Array vazio ([]) = sem restrição (cardinality = 0).
  // brandIds filtra via JOIN em products.brand_id, não pelo texto
  // denormalizado product_brand do snapshot.
  // -------------------------------------------------------------
  const reportRowsCte = `
    report_rows AS (
      SELECT s.*
      FROM seller_sales_order_item_snapshots s
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN contacts sc ON sc.id = s.seller_id
      WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND s.is_valid_sale = TRUE
        AND COALESCE(sc.name, '') <> 'Vendedor 0'
        AND (cardinality(ARRAY[:sellerIds]::uuid[]) = 0
             OR s.seller_id = ANY(ARRAY[:sellerIds]::uuid[]))
        AND (cardinality(ARRAY[:productIds]::uuid[]) = 0
             OR s.product_id = ANY(ARRAY[:productIds]::uuid[]))
        AND (cardinality(ARRAY[:brandIds]::uuid[]) = 0
             OR p.brand_id = ANY(ARRAY[:brandIds]::uuid[]))
        AND (CAST(:tireMeasure AS varchar) IS NULL
             OR s.product_measure = CAST(:tireMeasure AS varchar))
        AND (cardinality(ARRAY[:customerIds]::uuid[]) = 0
             OR s.customer_id = ANY(ARRAY[:customerIds]::uuid[]))
        AND (cardinality(ARRAY[:unitBusinessIds]::uuid[]) = 0
             OR s.unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[]))
    )
  `;


    const [summary] = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        COUNT(DISTINCT s.order_id) AS sales_count,
        COALESCE(SUM(s.quantity), 0) AS items_sold_count,
        ${calculateAverageTicketSql("SUM(s.net_total)", "COUNT(DISTINCT s.order_id)")} AS average_ticket,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.total_cost), 0) AS total_cost,
        COALESCE(SUM(s.markup_value), 0) AS total_markup_value,
        ${calculateMarkupSql("SUM(s.net_total)", "SUM(s.total_cost)").percent} AS average_markup_pct,
        COALESCE(SUM(s.contribution_value), 0) AS total_contribution_value,
        ${calculatePercentageSql("SUM(s.contribution_value)", "SUM(s.net_total)")} AS average_contribution_pct,
        COALESCE(SUM(s.manager_commission_value), 0) AS total_manager_commission
      FROM report_rows s
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Produtos Vendidos (tabela detalhada)
    // -------------------------------------------------------------
    const products = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        s.product_id,
        MAX(s.product_name) AS product_name,
        MAX(s.product_brand) AS product_brand,
        MAX(s.product_measure) AS product_measure,
        SUM(s.quantity) AS quantity,
        ${calculateSafeDivisionSql("SUM(s.net_total)", "SUM(s.quantity)", 4)} AS unit_value,
        SUM(s.net_total) AS sale_value,
        SUM(s.commission_value) AS commission_value,
        ${calculateMarkupSql("SUM(s.net_total)", "SUM(s.total_cost)").percent} AS markup_pct,
        ${calculatePercentageSql("SUM(s.contribution_value)", "SUM(s.net_total)")} AS contribution_pct
      FROM report_rows s
      GROUP BY s.product_id
      ORDER BY sale_value DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Ranking de Produtos
    // -------------------------------------------------------------
    const ranking = await sequelize.query(
      `
      WITH ${reportRowsCte},
      grouped AS (
        SELECT
          s.product_id,
          MAX(s.product_name) AS product_name,
          SUM(s.quantity) AS quantity,
          SUM(s.net_total) AS sale_value,
          SUM(s.contribution_value) AS contribution_value,
          SUM(s.commission_value) AS commission_value
        FROM report_rows s
        GROUP BY s.product_id
      )
      SELECT
        (SELECT product_name FROM grouped ORDER BY quantity DESC NULLS LAST LIMIT 1) AS most_sold_product,
        (SELECT product_name FROM grouped ORDER BY sale_value DESC NULLS LAST LIMIT 1) AS highest_revenue_product,
        (SELECT product_name FROM grouped ORDER BY contribution_value DESC NULLS LAST LIMIT 1) AS highest_profit_product,
        (SELECT product_name FROM grouped ORDER BY commission_value DESC NULLS LAST LIMIT 1) AS highest_commission_product
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Vendas por Loja (Unit Business)
    // -------------------------------------------------------------
    const byStore = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        s.unit_business_id,
        MAX(ub.name) AS unit_business_name,
        MAX(ub.number) AS unit_business_number,
        COUNT(DISTINCT s.order_id) AS sales_count,
        COALESCE(SUM(s.quantity), 0) AS items_sold_count,
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        ${calculateAverageTicketSql("SUM(s.net_total)", "COUNT(DISTINCT s.order_id)")} AS average_ticket,
        COALESCE(SUM(s.total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.markup_value), 0) AS total_markup_value,
        ${calculateMarkupSql("SUM(s.net_total)", "SUM(s.total_cost)").percent} AS markup_pct,
        COALESCE(SUM(s.contribution_value), 0) AS total_contribution_value,
        ${calculatePercentageSql("SUM(s.contribution_value)", "SUM(s.net_total)")} AS contribution_pct
      FROM report_rows s
      LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
      GROUP BY s.unit_business_id
      ORDER BY total_sold DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Vendas por Vendedor
    // -------------------------------------------------------------
    const bySeller = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        s.seller_id,
        MAX(ct.name) AS seller_name,
        COUNT(DISTINCT s.order_id) AS sales_count,
        COALESCE(SUM(s.quantity), 0) AS items_sold_count,
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        ${calculateAverageTicketSql("SUM(s.net_total)", "COUNT(DISTINCT s.order_id)")} AS average_ticket,
        COALESCE(SUM(s.total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.markup_value), 0) AS total_markup_value,
        ${calculateMarkupSql("SUM(s.net_total)", "SUM(s.total_cost)").percent} AS markup_pct,
        COALESCE(SUM(s.contribution_value), 0) AS total_contribution_value,
        ${calculatePercentageSql("SUM(s.contribution_value)", "SUM(s.net_total)")} AS contribution_pct
      FROM report_rows s
      LEFT JOIN contacts ct ON ct.id = s.seller_id
      GROUP BY s.seller_id
      ORDER BY total_sold DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Clientes Atendidos
    // -------------------------------------------------------------
    const customers = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        s.customer_id,
        MAX(c.name) AS customer_name,
        COUNT(DISTINCT s.order_id) AS purchases_count,
        COALESCE(SUM(s.net_total), 0) AS total_purchased,
        COALESCE(SUM(s.commission_value), 0) AS commission_generated
      FROM report_rows s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.customer_id IS NOT NULL
      GROUP BY s.customer_id
      ORDER BY total_purchased DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Evolução por Período (dia / semana / mês)
    // -------------------------------------------------------------
    const evolutionDaily = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        s.order_date AS period,
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        COUNT(DISTINCT s.order_id) AS sales_count
      FROM report_rows s
      GROUP BY s.order_date
      ORDER BY s.order_date ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    const evolutionWeekly = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        DATE_TRUNC('week', s.order_date)::date AS period,
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        COUNT(DISTINCT s.order_id) AS sales_count
      FROM report_rows s
      GROUP BY DATE_TRUNC('week', s.order_date)
      ORDER BY period ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    const evolutionMonthly = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        DATE_TRUNC('month', s.order_date)::date AS period,
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        COUNT(DISTINCT s.order_id) AS sales_count
      FROM report_rows s
      GROUP BY DATE_TRUNC('month', s.order_date)
      ORDER BY period ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    // -------------------------------------------------------------
    // Drill-down opcional: order_items detalhados do período/filtros
    // -------------------------------------------------------------
    const items = filters.drillDown
      ? await sequelize.query(
          `
          WITH ${reportRowsCte}
          SELECT
            s.*,
            ct.name AS seller_name
          FROM report_rows s
          LEFT JOIN contacts ct ON ct.id = s.seller_id
          ORDER BY s.order_date DESC, s.last_updated_at DESC
          `,
          {
            type: QueryTypes.SELECT,
            replacements: baseFilterReplacements,
          },
        )
      : undefined;

    // -------------------------------------------------------------
    // Comissão de Gerente por Filial (regra específica deste relatório,
    // sem equivalente em sales_report — mantida como antes)
    // -------------------------------------------------------------
    const byManager = await sequelize.query(
      `
  WITH ${reportRowsCte}
  SELECT
    u.id AS manager_id,
    u.name AS manager_name,
    s.unit_business_id,
    MAX(ub.name) AS unit_business_name,
    MAX(ub.number) AS unit_business_number,
    COALESCE(SUM(s.net_total), 0) AS branch_total_sold,
    COALESCE(SUM(s.manager_commission_value), 0) AS total_manager_commission
  FROM report_rows s
  JOIN users u
    ON u.main_unit_business_id = s.unit_business_id
  JOIN user_config uc
    ON uc.user_id = u.id
   AND uc.type = 'manager'
  LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
  GROUP BY u.id, u.name, s.unit_business_id
  ORDER BY branch_total_sold DESC
  `,
      { type: QueryTypes.SELECT, replacements: baseFilterReplacements },
    );

    const managerCommissionByBrand = await sequelize.query(
  `
  WITH ${reportRowsCte}
  SELECT
    s.product_brand,
    COALESCE(SUM(s.net_total), 0) AS total_revenue,
    COALESCE(SUM(s.manager_commission_value), 0) AS total_manager_commission
  FROM report_rows s
  WHERE s.product_brand IS NOT NULL
  GROUP BY s.product_brand
  ORDER BY total_revenue DESC
  `,
  { type: QueryTypes.SELECT, replacements: baseFilterReplacements },
);

    return {
      filters,
      summary,
      products,
      ranking: ranking[0],
      byStore,
      byManager,
      managerCommissionByBrand,
      bySeller,
      customers,
      evolution: {
        daily: evolutionDaily,
        weekly: evolutionWeekly,
        monthly: evolutionMonthly,
      },
      ...(items ? { items } : {}),
    };
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

export const sellerSalesReportRepository = new SellerSalesReportRepository();