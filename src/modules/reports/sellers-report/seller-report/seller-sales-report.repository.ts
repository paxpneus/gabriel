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

/**
 * Situações de pedido consideradas "venda válida" (actual_situation):
 * 6 e 9. Quando orders.actual_situation está vazio/nulo, cai-se para o
 * status da invoice associada: qualquer status diferente de CANCELLED
 * e PENDING_CANCELLED_SYSTEM é considerado válido.
 *
 * NOTA: a coluna `invoices.status` e `invoices.seller_id` são assumidas
 * com base no padrão visto em invoices (usadas no daily_operation_report
 * e mencionadas na FK invoices_seller_id_fkey -> contacts). Validar nome
 * exato da coluna de status em invoices antes de rodar em produção.
 *
 * NOTA SOBRE A TABELA `seller_sales_order_item_snapshots`:
 * Existe no banco uma tabela `sales_order_item_snapshots` que pertence a
 * OUTRO relatório (snapshot fiscal/operacional por loja, com order_snapshot_id
 * obrigatório e colunas de imposto — icms, ipi, pis, cofins, ncm, cest, cfop).
 * Para não acoplar o seller_sales_report a uma estrutura de outro domínio,
 * este job usa sua PRÓPRIA tabela, `seller_sales_order_item_snapshots`
 * (ver migration). Não confundir as duas.
 *
 * NOTA SOBRE ICMS E "total_cost":
 * order_items não tem ICMS por linha — ICMS só existe no nível do pedido
 * (orders.icms_value), calculado sobre orders.total_price. Para o relatório
 * de vendedor (que agrega por item) fazer sentido item a item, o ICMS do
 * pedido é rateado entre os itens proporcionalmente ao peso de cada item
 * dentro do pedido (net_total_raw do item / soma de net_total_raw do pedido).
 *
 * Esse mesmo peso também é usado para "desfazer" o problema de que
 * order_items.net_total vem BRUTO da Bling (sem descontar taxa de
 * comissão do ML nem frete) — só orders.total_price já vem líquido desses
 * descontos. net_total_allocated = peso do item * orders.total_price, e é
 * esse valor (não o bruto) que é gravado como `net_total` na snapshot.
 *
 * A coluna `total_cost` gravada e usada em toda a cadeia (snapshots,
 * fact tables, getReport) é `total_cost_with_icms` = custo do produto
 * (já com kit/comissão, vindo de order_items.total_cost_snapshot) + ICMS
 * rateado do pedido. Isso garante que, somando os itens de um pedido,
 * total_cost bate com orders.total_cost, e que markup/contribution
 * (calculados a partir desse total_cost) sejam consistentes com o valor
 * de custo exibido ao lado no relatório.
 *
 * NOTA SOBRE A FONTE DE DADOS DO getReport (revisão):
 * summary, products, ranking e evolution (daily/weekly/monthly) passaram
 * a ler diretamente de seller_sales_order_item_snapshots, assim como
 * byStore e bySeller já faziam. Antes eles liam de daily_seller_product_facts,
 * que:
 *   (a) não tem unit_business_id nem customer_id, exigindo um EXISTS pesado
 *       e incorreto contra orders/order_items/invoices para filtrar por loja
 *       (o EXISTS comparava invoices.seller_id com o seller_id do pedido,
 *       colunas que não têm por que bater 1:1, zerando o filtro na prática);
 *   (b) não permitia filtrar por customerId de forma alguma;
 *   (c) somava orders_count por linha de (fact_date, seller_id, product_id),
 *       contando o mesmo pedido mais de uma vez quando ele tinha múltiplos
 *       produtos diferentes (COUNT(DISTINCT order_id) só evita duplicar
 *       dentro do mesmo produto, não entre produtos do mesmo pedido).
 * Lendo direto do snapshot (que já tem unit_business_id e customer_id por
 * linha, e nunca é pré-agrupado por produto) os três problemas somem.
 *
 * NOTA SOBRE O BUG DE CONTRIBUIÇÃO ≠ (total_sold - total_cost) NO getReport:
 * `report_total_cost` (calculado em `report_rows`) podia virar SQL NULL em
 * duas situações:
 *   1. `s.total_cost` NULL ou 0 E `s.average_cost` NULL ao mesmo tempo
 *      (o COALESCE(NULLIF(total_cost,0), average_cost*qty + icms) não tinha
 *      fallback final, então se o segundo termo também fosse NULL o
 *      resultado inteiro era NULL);
 *   2. Qualquer linha onde `average_cost` fosse NULL mas `total_cost` fosse
 *      0 (não NULL) — o NULLIF(total_cost, 0) zera para NULL e cai no
 *      fallback quebrado do item 1.
 * Como `report_markup_value`/`report_contribution_value` são calculados com
 * `CASE WHEN report_total_cost IS NULL THEN NULL ELSE ...`, essas linhas
 * problemáticas ficavam de fora do SUM() de custo e de contribuição — mas
 * o `net_total` delas (nunca NULL) continuava entrando no SUM() de
 * total_sold. Resultado: total_sold - total_cost (somados) ficava maior
 * que total_contribution_value, porque cada soma "perdia" linhas diferentes.
 * Correção: `report_total_cost` agora tem um COALESCE final para 0, e o
 * fallback usa COALESCE(average_cost, 0) em vez de average_cost puro, então
 * `report_total_cost` NUNCA é NULL — toda linha entra em todas as somas de
 * forma consistente, e total_sold - total_cost bate exatamente com
 * total_contribution_value (e o mesmo vale para markup_value).
 *
 * NOTA SOBRE total_manager_commission NO summary:
 * manager_commission_value já é calculado por item (net_total_allocated *
 * manager_commission_rate) e já era somado em byManager. Faltava agregar
 * o total geral no summary — adicionado via SUM(s.manager_commission_value),
 * disponível em report_rows/report_metrics através do s.* do snapshot.
 */
const VALID_ACTUAL_SITUATIONS = ["6", "9"];
const INVALID_ORDER_STATUSES = ["CANCELLED"];

interface CheckpointRow {
  last_processed_at: Date;
}

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
   * Pedidos afetados desde o último checkpoint: pelo próprio order,
   * pelos seus items, ou pela invoice associada (já que o status de
   * venda válida pode depender de invoices.status).
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

    await sequelize.query(
      `
    WITH affected(order_id) AS (
  SELECT unnest(ARRAY[:orderIds]::uuid[])
),
valid_orders AS (
  SELECT
    o.id AS order_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM order_items cost_check
        WHERE cost_check.order_id = o.id
          AND COALESCE(cost_check.average_cost_snapshot, 0) <= 0
      ) THEN FALSE
      WHEN NULLIF(o.internal_status::text, '') IS NOT NULL THEN
        o.internal_status::text NOT IN ('CANCELLED', 'UNKNOWN')
      ELSE
        o.actual_situation IN ('6', '9', '748748', '748743')
    END AS is_valid_sale
  FROM orders o
  JOIN affected a ON a.order_id = o.id
),
snapshot_source AS (
  SELECT
    oi.id AS order_item_id,
    o.id AS order_id,
    o.seller_id,
    o.customer_id,
    oi.product_id,
    o.unit_business_id,
    o.total_price AS order_total_price,
    o.icms_value  AS order_icms_value,

    DATE(o.date) AS order_date,
    p.name AS product_name,
    p.brand AS product_brand,
    p.measure AS product_measure,

    oi.quantity,
    oi.unit_price,

    -- valor BRUTO vindo da Bling (sem desconto de taxa ML/frete) — usado
    -- apenas para calcular o PESO do item dentro do pedido, nunca gravado
    -- diretamente como net_total.
    COALESCE(oi.net_total, 0)::numeric AS net_total_raw,

    -- custo do produto já congelado (kit + comissão). Quando o total não
    -- veio pronto, seguimos o sales_report e derivamos de average_cost * qty.
    oi.average_cost_snapshot::numeric AS average_cost,
    oi.total_cost_snapshot::numeric   AS total_cost_product,
    (oi.average_cost_snapshot IS NOT NULL) AS has_cost_data,

    COALESCE(oi.commission_base, 0)::numeric AS commission_base,
    COALESCE(oi.commission_rate, 0)::numeric AS commission_rate,
    COALESCE(oi.commission_value, 0)::numeric AS commission_value,
    COALESCE(oi.comission_manager_rate, 0)::numeric AS manager_commission_rate,


    vo.is_valid_sale
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN affected a ON a.order_id = o.id
  JOIN valid_orders vo ON vo.order_id = o.id
  LEFT JOIN products p ON p.id = oi.product_id
  LEFT JOIN contacts sc ON sc.id = o.seller_id
  WHERE COALESCE(sc.name, '') <> 'Vendedor 0'
),
snapshot_weighted AS (
  SELECT
    *,
    -- peso do item dentro do pedido: soma dos pesos de todos os itens de
    -- um mesmo pedido é sempre 1, então tudo que é rateado por esse peso
    -- (receita líquida, ICMS) fecha exatamente com o total do pedido.
    CASE
      WHEN SUM(net_total_raw) OVER (PARTITION BY order_id) = 0 THEN 0
      ELSE net_total_raw / SUM(net_total_raw) OVER (PARTITION BY order_id)
    END AS item_weight
  FROM snapshot_source
),
snapshot_final AS (
  SELECT
    *,
    ROUND(item_weight * order_total_price, 2) AS net_total_allocated,
    ROUND(item_weight * COALESCE(order_icms_value, 0), 2) AS icms_value_allocated
  FROM snapshot_weighted
),
snapshot_calc AS (
  SELECT
    *,
    COALESCE(total_cost_product, ROUND((average_cost * quantity)::numeric, 2)) AS total_cost_product_resolved
  FROM snapshot_final
),
snapshot_metrics AS (
  SELECT
    *,
    -- custo do item = custo de produto resolvido + fatia de ICMS do pedido,
    -- mesma base usada no sales_report.
    CASE WHEN total_cost_product_resolved IS NULL THEN NULL
         ELSE total_cost_product_resolved + icms_value_allocated
    END AS total_cost_with_icms,

    CASE WHEN total_cost_product_resolved IS NULL THEN NULL
         ELSE net_total_allocated - (total_cost_product_resolved + icms_value_allocated)
    END AS markup_value,

    CASE
      WHEN total_cost_product_resolved IS NULL THEN NULL
      WHEN (total_cost_product_resolved + icms_value_allocated) = 0 THEN 0
      ELSE ROUND(
        (((net_total_allocated - (total_cost_product_resolved + icms_value_allocated))
          / (total_cost_product_resolved + icms_value_allocated)) * 100)::numeric,
        2
      )
    END AS markup_pct,

    CASE WHEN total_cost_product_resolved IS NULL THEN NULL
         ELSE net_total_allocated - (total_cost_product_resolved + icms_value_allocated)
    END AS contribution_value,

    CASE
      WHEN total_cost_product_resolved IS NULL THEN NULL
      WHEN net_total_allocated = 0 THEN 0
      ELSE ROUND(
        (((net_total_allocated - (total_cost_product_resolved + icms_value_allocated))
          / net_total_allocated) * 100)::numeric,
        2
      )
    END AS contribution_pct,

    -- comissão do gerente = net_total já rateado do pedido (net_total_allocated)
    -- multiplicado pela taxa de comissão de gerente vigente no item (vinda da
    -- brand do produto, congelada em order_items.comission_manager_rate).
    ROUND(net_total_allocated * manager_commission_rate / 100, 2) AS manager_commission_value
  FROM snapshot_calc
)
INSERT INTO seller_sales_order_item_snapshots (
  order_item_id, order_id, seller_id, customer_id, product_id, unit_business_id,
  order_date, product_name, product_brand, product_measure,
  quantity, unit_price, net_total, average_cost, total_cost, has_cost_data,
  icms_value_allocated,
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
  average_cost,
  total_cost_with_icms AS total_cost,
  has_cost_data,
  icms_value_allocated,
  commission_base, commission_rate, commission_value,
  manager_commission_rate, manager_commission_value,
  markup_value, markup_pct,
  contribution_value, contribution_pct, is_valid_sale,
  NOW(), NOW(), NOW()
FROM snapshot_metrics
ON CONFLICT (order_item_id) DO UPDATE SET
  seller_id                = EXCLUDED.seller_id,
  customer_id              = EXCLUDED.customer_id,
  product_id               = EXCLUDED.product_id,
  unit_business_id         = EXCLUDED.unit_business_id,
  order_date               = EXCLUDED.order_date,
  product_name             = EXCLUDED.product_name,
  product_brand            = EXCLUDED.product_brand,
  product_measure          = EXCLUDED.product_measure,
  quantity                 = EXCLUDED.quantity,
  unit_price               = EXCLUDED.unit_price,
  net_total                = EXCLUDED.net_total,
  average_cost             = EXCLUDED.average_cost,
  total_cost               = EXCLUDED.total_cost,
  has_cost_data            = EXCLUDED.has_cost_data,
  icms_value_allocated     = EXCLUDED.icms_value_allocated,
  commission_base          = EXCLUDED.commission_base,
  commission_rate          = EXCLUDED.commission_rate,
  commission_value         = EXCLUDED.commission_value,
  manager_commission_rate  = EXCLUDED.manager_commission_rate,
  manager_commission_value = EXCLUDED.manager_commission_value,
  markup_value             = EXCLUDED.markup_value,
  markup_pct               = EXCLUDED.markup_pct,
  contribution_value       = EXCLUDED.contribution_value,
  contribution_pct         = EXCLUDED.contribution_pct,
  is_valid_sale            = EXCLUDED.is_valid_sale,
  last_updated_at          = NOW(),
  updated_at               = NOW()
    `,
      {
        replacements: {
          orderIds,
          invalidOrderStatuses: INVALID_ORDER_STATUSES,
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
            -- total_cost já é total_cost_with_icms (produto + ICMS rateado),
            -- gravado como "total_cost" na tabela de snapshot.
            COALESCE(SUM(total_cost), 0) AS total_cost,
            COALESCE(SUM(commission_value), 0) AS total_commission,
            COALESCE(SUM(markup_value), 0) AS total_markup_value,
            COALESCE(SUM(contribution_value), 0) AS total_contribution_value
          FROM seller_sales_order_item_snapshots
          WHERE order_date = CAST(:factDate AS date)
            AND seller_id = CAST(:sellerId AS uuid)
            AND product_id = CAST(:productId AS uuid)
            AND is_valid_sale = TRUE
            AND NOT EXISTS (
              SELECT 1
              FROM seller_sales_order_item_snapshots cost_check
              WHERE cost_check.order_id = seller_sales_order_item_snapshots.order_id
                AND COALESCE(cost_check.average_cost, 0) <= 0
            )
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
            AND NOT EXISTS (
              SELECT 1
              FROM seller_sales_order_item_snapshots cost_check
              WHERE cost_check.order_id = s.order_id
                AND COALESCE(cost_check.average_cost, 0) <= 0
            )
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

  async getReport(filters: SellerSalesReportFilters) {
    const baseFilterReplacements = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      sellerId: filters.sellerId ?? null,
      productId: filters.productId ?? null,
      brand: filters.brand ?? null,
      tireMeasure: filters.tireMeasure ?? null,
      customerId: filters.customerId ?? null,
      unitBusinessId: filters.unitBusinessId ?? null,
    };

    // -------------------------------------------------------------
    // Indicadores Gerais
    //
    // Lê direto de seller_sales_order_item_snapshots (mesma fonte de
    // byStore/bySeller) em vez de daily_seller_product_facts: essa tabela
    // já tem unit_business_id e customer_id por linha, então os filtros
    // funcionam sem precisar de EXISTS contra orders/invoices, e
    // sales_count usa COUNT(DISTINCT order_id) direto, sem risco de contar
    // o mesmo pedido mais de uma vez quando ele tem múltiplos produtos.
    //
    // FIX: report_total_cost agora tem COALESCE final para 0 e usa
    // COALESCE(s.average_cost, 0) no fallback, garantindo que NUNCA seja
    // SQL NULL. Antes, quando total_cost era NULL/0 E average_cost também
    // era NULL, report_total_cost virava NULL, o que fazia essa linha ser
    // ignorada no SUM() de custo e de contribuição — mas não no SUM() de
    // net_total (nunca NULL) — quebrando a consistência
    // total_sold - total_cost == total_contribution_value.
    // -------------------------------------------------------------
    const reportRowsCte = `
      report_rows AS (
        SELECT
          s.*,
          COALESCE(
            NULLIF(s.total_cost, 0),
            ROUND((COALESCE(s.average_cost, 0) * s.quantity)::numeric, 2)
              + COALESCE(s.icms_value_allocated, 0),
            0
          ) AS report_total_cost
        FROM seller_sales_order_item_snapshots s
        WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
          AND s.is_valid_sale = TRUE
          AND NOT EXISTS (
            SELECT 1
            FROM seller_sales_order_item_snapshots cost_check
            WHERE cost_check.order_id = s.order_id
              AND COALESCE(cost_check.average_cost, 0) <= 0
          )
          AND (CAST(:sellerId AS uuid) IS NULL OR s.seller_id = CAST(:sellerId AS uuid))
          AND (CAST(:productId AS uuid) IS NULL OR s.product_id = CAST(:productId AS uuid))
          AND (CAST(:brand AS varchar) IS NULL OR s.product_brand = CAST(:brand AS varchar))
          AND (CAST(:tireMeasure AS varchar) IS NULL OR s.product_measure = CAST(:tireMeasure AS varchar))
          AND (CAST(:customerId AS uuid) IS NULL OR s.customer_id = CAST(:customerId AS uuid))
          AND (CAST(:unitBusinessId AS uuid) IS NULL OR s.unit_business_id = CAST(:unitBusinessId AS uuid))
      ),
      report_metrics AS (
        SELECT
          *,
          net_total - report_total_cost AS report_markup_value,
          net_total - report_total_cost AS report_contribution_value
        FROM report_rows
      )
    `;

    const [summary] = await sequelize.query(
      `
      WITH ${reportRowsCte}
      SELECT
        COALESCE(SUM(s.net_total), 0) AS total_sold,
        COUNT(DISTINCT s.order_id) AS sales_count,
        COALESCE(SUM(s.quantity), 0) AS items_sold_count,
        CASE
          WHEN COUNT(DISTINCT s.order_id) = 0 THEN 0
          ELSE ROUND(SUM(s.net_total) / COUNT(DISTINCT s.order_id), 2)
        END AS average_ticket,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.report_total_cost), 0) AS total_cost,
        COALESCE(SUM(s.report_markup_value), 0) AS total_markup_value,
        CASE
          WHEN COALESCE(SUM(s.report_total_cost), 0) = 0 THEN 0
          ELSE ROUND((SUM(s.report_markup_value) / SUM(s.report_total_cost)) * 100, 2)
        END AS average_markup_pct,
        COALESCE(SUM(s.report_contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN COALESCE(SUM(s.net_total), 0) = 0 THEN 0
          ELSE ROUND((SUM(s.report_contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS average_contribution_pct,
        -- NOVO: total geral de comissão de gerente no período/filtros.
        -- manager_commission_value já vem por item (calculado em
        -- upsertSnapshots) e chega aqui via s.* de report_rows.
        COALESCE(SUM(s.manager_commission_value), 0) AS total_manager_commission
      FROM report_metrics s
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
        CASE
          WHEN SUM(s.quantity) = 0 THEN 0
          ELSE ROUND(SUM(s.net_total) / SUM(s.quantity), 4)
        END AS unit_value,
        SUM(s.net_total) AS sale_value,
        SUM(s.commission_value) AS commission_value,
        CASE
          WHEN SUM(s.report_total_cost) = 0 THEN 0
          ELSE ROUND((SUM(s.report_markup_value) / SUM(s.report_total_cost)) * 100, 2)
        END AS markup_pct,
        CASE
          WHEN SUM(s.net_total) = 0 THEN 0
          ELSE ROUND((SUM(s.report_contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS contribution_pct
      FROM report_metrics s
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
          SUM(s.report_contribution_value) AS contribution_value,
          SUM(s.commission_value) AS commission_value
        FROM report_metrics s
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
        CASE
          WHEN COUNT(DISTINCT s.order_id) = 0 THEN 0
          ELSE ROUND(SUM(s.net_total) / COUNT(DISTINCT s.order_id), 2)
        END AS average_ticket,
        COALESCE(SUM(s.report_total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.report_markup_value), 0) AS total_markup_value,
        CASE
          WHEN SUM(s.report_total_cost) = 0 THEN 0
          ELSE ROUND((SUM(s.report_markup_value) / SUM(s.report_total_cost)) * 100, 2)
        END AS markup_pct,
        COALESCE(SUM(s.report_contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN SUM(s.net_total) = 0 THEN 0
          ELSE ROUND((SUM(s.report_contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS contribution_pct
      FROM report_metrics s
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
        CASE
          WHEN COUNT(DISTINCT s.order_id) = 0 THEN 0
          ELSE ROUND(SUM(s.net_total) / COUNT(DISTINCT s.order_id), 2)
        END AS average_ticket,
        COALESCE(SUM(s.report_total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.report_markup_value), 0) AS total_markup_value,
        CASE
          WHEN SUM(s.report_total_cost) = 0 THEN 0
          ELSE ROUND((SUM(s.report_markup_value) / SUM(s.report_total_cost)) * 100, 2)
        END AS markup_pct,
        COALESCE(SUM(s.report_contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN SUM(s.net_total) = 0 THEN 0
          ELSE ROUND((SUM(s.report_contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS contribution_pct
      FROM report_metrics s
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
    // (daily_seller_customer_facts não possui unit_business_id — sem filtro aqui)
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
      FROM report_metrics s
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
      FROM report_metrics s
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
      FROM report_metrics s
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
      FROM report_metrics s
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
          FROM report_metrics s
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
    // Comissão de Gerente por Filial
    // Regra: user com user_config.type = 'manager' e main_unit_business_id
    // preenchido (cada user tem exatamente 1 user_config, 1:1 via user_id).
    // A comissão já vem calculada por item (manager_commission_value,
    // baseada na manager_commission_rate congelada do order_item, vinda da
    // brand do produto), aqui só agregamos por filial e juntamos com o
    // gerente responsável por ela.
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
        COALESCE(SUM(s.manager_commission_value), 0) AS total_manager_commission,
        COALESCE(SUM(s.net_total), 0) - COALESCE(SUM(s.manager_commission_value), 0)
          AS branch_net_after_manager_commission
      FROM report_metrics s
      JOIN users u
        ON u.main_unit_business_id = s.unit_business_id
      JOIN user_config uc
        ON uc.user_id = u.id
       AND uc.type = 'manager'
      LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
      GROUP BY u.id, u.name, s.unit_business_id
      ORDER BY branch_total_sold DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    return {
      filters,
      summary,
      products,
      ranking: ranking[0],
      byStore,
      byManager,
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