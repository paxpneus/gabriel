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
 */
const VALID_ACTUAL_SITUATIONS = ["6", "9"];
const INVALID_INVOICE_STATUSES = ["CANCELLED", "PENDING_CANCELLED_SYSTEM"];

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

       UNION

      SELECT o.id AS order_id
      FROM orders o
      JOIN invoice_unit_business_attributes iuba
        ON iuba.invoice_id = o.invoice_id
      AND iuba.unit_business_id = o.unit_business_id
      WHERE iuba.updated_at >= :lastProcessedAt
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
      -- Vendedor: orders -> invoices (orders.invoice_id) -> invoices.seller_id -> contacts
      order_seller AS (
      SELECT
        o.id AS order_id,
        o.invoice_id,
        inv.seller_id,
        iuba.status AS invoice_status
      FROM orders o
      JOIN affected a ON a.order_id = o.id
      LEFT JOIN invoices inv ON inv.id = o.invoice_id
      LEFT JOIN invoice_unit_business_attributes iuba
        ON iuba.invoice_id = o.invoice_id
      AND iuba.unit_business_id = o.unit_business_id
    ),
      -- Regra de venda válida:
      -- 1) Se orders.actual_situation in ('6','9') -> válida
      -- 2) Se actual_situation vazio/nulo -> usa invoices.status,
      --    válida se for diferente de CANCELLED e PENDING_CANCELLED_SYSTEM
      valid_orders AS (
        SELECT
          o.id AS order_id,
          CASE
            WHEN o.actual_situation IS NOT NULL AND o.actual_situation <> ''
              THEN o.actual_situation = ANY(ARRAY[:validActualSituations])
            ELSE
              os.invoice_status IS NULL
              OR os.invoice_status::text <> ALL(ARRAY[:invalidInvoiceStatuses])
          END AS is_valid_sale
        FROM orders o
        JOIN affected a ON a.order_id = o.id
        LEFT JOIN order_seller os ON os.order_id = o.id
      ),
      snapshot_source AS (
        SELECT
          oi.id AS order_item_id,
          o.id AS order_id,
          os.seller_id,
          o.customer_id,
          oi.product_id,
          o.unit_business_id,

          DATE(o.date) AS order_date,
          p.name AS product_name,
          p.brand AS product_brand,
          p.measure AS product_measure,

          oi.quantity,
          oi.unit_price,
          COALESCE(oi.net_total, 0)::numeric AS net_total,

          COALESCE(pc.average_cost, 0)::numeric AS average_cost,
          COALESCE(pc.average_cost, 0)::numeric * COALESCE(oi.quantity, 0)::numeric AS total_cost,

          COALESCE(p.commission, 0)::numeric AS commission_rate,
          COALESCE(oi.net_total, 0)::numeric * COALESCE(p.commission, 0)::numeric AS commission_value,

          vo.is_valid_sale
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN affected a ON a.order_id = o.id
        JOIN order_seller os ON os.order_id = o.id
        JOIN valid_orders vo ON vo.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_configs pc
          ON pc.product_id = oi.product_id
         AND pc.unit_business_id = o.unit_business_id
      ),
      snapshot_calc AS (
        SELECT
          *,
          (net_total - total_cost) AS markup_value,
          CASE
            WHEN total_cost = 0 THEN 0
            ELSE ROUND((((net_total - total_cost) / total_cost) * 100)::numeric, 2)
          END AS markup_pct,
          (net_total - total_cost - commission_value) AS contribution_value,
          CASE
            WHEN net_total = 0 THEN 0
            ELSE ROUND((((net_total - total_cost - commission_value) / net_total) * 100)::numeric, 2)
          END AS contribution_pct
        FROM snapshot_source
      )
      INSERT INTO seller_sales_order_item_snapshots (
        order_item_id,
        order_id,
        seller_id,
        customer_id,
        product_id,
        unit_business_id,
        order_date,
        product_name,
        product_brand,
        product_measure,
        quantity,
        unit_price,
        net_total,
        average_cost,
        total_cost,
        commission_rate,
        commission_value,
        markup_value,
        markup_pct,
        contribution_value,
        contribution_pct,
        is_valid_sale,
        last_updated_at,
        created_at,
        updated_at
      )
      SELECT
        order_item_id,
        order_id,
        seller_id,
        customer_id,
        product_id,
        unit_business_id,
        order_date,
        product_name,
        product_brand,
        product_measure,
        quantity,
        unit_price,
        net_total,
        average_cost,
        total_cost,
        commission_rate,
        commission_value,
        markup_value,
        markup_pct,
        contribution_value,
        contribution_pct,
        is_valid_sale,
        NOW(),
        NOW(),
        NOW()
      FROM snapshot_calc
      ON CONFLICT (order_item_id) DO UPDATE SET
        seller_id           = EXCLUDED.seller_id,
        customer_id         = EXCLUDED.customer_id,
        product_id          = EXCLUDED.product_id,
        unit_business_id    = EXCLUDED.unit_business_id,
        order_date          = EXCLUDED.order_date,
        product_name        = EXCLUDED.product_name,
        product_brand       = EXCLUDED.product_brand,
        product_measure     = EXCLUDED.product_measure,
        quantity            = EXCLUDED.quantity,
        unit_price          = EXCLUDED.unit_price,
        net_total           = EXCLUDED.net_total,
        average_cost        = EXCLUDED.average_cost,
        total_cost          = EXCLUDED.total_cost,
        commission_rate     = EXCLUDED.commission_rate,
        commission_value    = EXCLUDED.commission_value,
        markup_value        = EXCLUDED.markup_value,
        markup_pct          = EXCLUDED.markup_pct,
        contribution_value  = EXCLUDED.contribution_value,
        contribution_pct    = EXCLUDED.contribution_pct,
        is_valid_sale       = EXCLUDED.is_valid_sale,
        last_updated_at     = NOW(),
        updated_at          = NOW()
      `,
      {
        replacements: {
          orderIds,
          validActualSituations: VALID_ACTUAL_SITUATIONS,
          invalidInvoiceStatuses: INVALID_INVOICE_STATUSES,
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

  async getReport(filters: SellerSalesReportFilters) {
    const baseFilterReplacements = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      sellerId: filters.sellerId ?? null,
      productId: filters.productId ?? null,
      brand: filters.brand ?? null,
      tireMeasure: filters.tireMeasure ?? null,
      customerId: filters.customerId ?? null,
      // ✅ Novo filtro: unitBusinessId (opcional, null = sem filtro)
      unitBusinessId: filters.unitBusinessId ?? null,
    };

    // Cláusula de filtro por unit_business_id reutilizada nas queries
    // que possuem essa coluna: daily_seller_product_facts e seller_sales_order_item_snapshots.
    // daily_seller_customer_facts NÃO possui unit_business_id, portanto não recebe o filtro.

    // -------------------------------------------------------------
    // Indicadores Gerais
    // -------------------------------------------------------------
    const [summary] = await sequelize.query(
      `
      SELECT
        COALESCE(SUM(total_sold), 0) AS total_sold,
        COALESCE(SUM(orders_count), 0) AS sales_count,
        COALESCE(SUM(quantity_sold), 0) AS items_sold_count,
        CASE
          WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
          ELSE ROUND(SUM(total_sold) / SUM(orders_count), 2)
        END AS average_ticket,
        COALESCE(SUM(total_commission), 0) AS total_commission,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        COALESCE(SUM(total_markup_value), 0) AS total_markup_value,
        CASE
          WHEN COALESCE(SUM(total_cost), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_markup_value) / SUM(total_cost)) * 100, 2)
        END AS average_markup_pct,
        COALESCE(SUM(total_contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN COALESCE(SUM(total_sold), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_contribution_value) / SUM(total_sold)) * 100, 2)
        END AS average_contribution_pct
      FROM daily_seller_product_facts dspf
      WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
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
      SELECT
        dspf.product_id,
        MAX(dspf.product_name) AS product_name,
        MAX(dspf.product_brand) AS product_brand,
        MAX(dspf.product_measure) AS product_measure,
        SUM(dspf.quantity_sold) AS quantity,
        CASE
          WHEN SUM(dspf.quantity_sold) = 0 THEN 0
          ELSE ROUND(SUM(dspf.total_sold) / SUM(dspf.quantity_sold), 4)
        END AS unit_value,
        SUM(dspf.total_sold) AS sale_value,
        SUM(dspf.total_commission) AS commission_value,
        CASE
          WHEN SUM(dspf.total_cost) = 0 THEN 0
          ELSE ROUND((SUM(dspf.total_markup_value) / SUM(dspf.total_cost)) * 100, 2)
        END AS markup_pct,
        CASE
          WHEN SUM(dspf.total_sold) = 0 THEN 0
          ELSE ROUND((SUM(dspf.total_contribution_value) / SUM(dspf.total_sold)) * 100, 2)
        END AS contribution_pct
      FROM daily_seller_product_facts dspf
      WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
      GROUP BY dspf.product_id
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
      WITH grouped AS (
        SELECT
          dspf.product_id,
          MAX(dspf.product_name) AS product_name,
          SUM(dspf.quantity_sold) AS quantity,
          SUM(dspf.total_sold) AS sale_value,
          SUM(dspf.total_contribution_value) AS contribution_value,
          SUM(dspf.total_commission) AS commission_value
        FROM daily_seller_product_facts dspf
        WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
          AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
          AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
          AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
          AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
          AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
        GROUP BY dspf.product_id
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
    //
    // Usamos seller_sales_order_item_snapshots diretamente em vez das tabelas
    // de fato diárias (daily_seller_*_facts) porque elas NÃO possuem
    // unit_business_id — agrupar por loja a partir delas exigiria o
    // mesmo JOIN/EXISTS pesado contra orders/invoices usado acima,
    // o que anula a vantagem de usar uma tabela pré-agregada.
    // seller_sales_order_item_snapshots já guarda unit_business_id por linha,
    // então o agrupamento aqui é direto.
    //
    // Se filters.unitBusinessId estiver preenchido, o WHERE abaixo já
    // restringe os dados antes do GROUP BY, então o resultado natural
    // será apenas 1 linha (a da loja filtrada).
    // -------------------------------------------------------------
    const byStore = await sequelize.query(
      `
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
        COALESCE(SUM(s.total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.markup_value), 0) AS total_markup_value,
        CASE
          WHEN SUM(s.total_cost) = 0 THEN 0
          ELSE ROUND((SUM(s.markup_value) / SUM(s.total_cost)) * 100, 2)
        END AS markup_pct,
        COALESCE(SUM(s.contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN SUM(s.net_total) = 0 THEN 0
          ELSE ROUND((SUM(s.contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS contribution_pct
      FROM seller_sales_order_item_snapshots s
      LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
      WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND s.is_valid_sale = TRUE
        AND (CAST(:sellerId AS uuid) IS NULL OR s.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR s.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR s.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR s.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:customerId AS uuid) IS NULL OR s.customer_id = CAST(:customerId AS uuid))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR s.unit_business_id = CAST(:unitBusinessId AS uuid))
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
    //
    // Mesmo raciocínio do bloco acima: usamos seller_sales_order_item_snapshots
    // (que já tem seller_id por linha) em vez de daily_seller_product_facts,
    // para manter a MESMA fonte de dados entre "por loja" e "por vendedor"
    // — evita que os dois quadros fiquem com números levemente diferentes
    // por causa de timing de agregação entre tabelas.
    //
    // Se filters.sellerId estiver preenchido, o resultado natural também
    // será 1 linha (a do vendedor filtrado).
    // -------------------------------------------------------------
    const bySeller = await sequelize.query(
      `
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
        COALESCE(SUM(s.total_cost), 0) AS total_cost,
        COALESCE(SUM(s.commission_value), 0) AS total_commission,
        COALESCE(SUM(s.markup_value), 0) AS total_markup_value,
        CASE
          WHEN SUM(s.total_cost) = 0 THEN 0
          ELSE ROUND((SUM(s.markup_value) / SUM(s.total_cost)) * 100, 2)
        END AS markup_pct,
        COALESCE(SUM(s.contribution_value), 0) AS total_contribution_value,
        CASE
          WHEN SUM(s.net_total) = 0 THEN 0
          ELSE ROUND((SUM(s.contribution_value) / SUM(s.net_total)) * 100, 2)
        END AS contribution_pct
      FROM seller_sales_order_item_snapshots s
      LEFT JOIN contacts ct ON ct.id = s.seller_id
      WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND s.is_valid_sale = TRUE
        AND (CAST(:sellerId AS uuid) IS NULL OR s.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR s.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR s.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR s.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:customerId AS uuid) IS NULL OR s.customer_id = CAST(:customerId AS uuid))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR s.unit_business_id = CAST(:unitBusinessId AS uuid))
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
      SELECT
        dscf.customer_id,
        MAX(dscf.customer_name) AS customer_name,
        SUM(dscf.orders_count) AS purchases_count,
        SUM(dscf.total_purchased) AS total_purchased,
        SUM(dscf.total_commission) AS commission_generated
      FROM daily_seller_customer_facts dscf
      WHERE dscf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dscf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:customerId AS uuid) IS NULL OR dscf.customer_id = CAST(:customerId AS uuid))
      GROUP BY dscf.customer_id
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
      SELECT
        dspf.fact_date AS period,
        SUM(dspf.total_sold) AS total_sold,
        SUM(dspf.orders_count) AS sales_count
      FROM daily_seller_product_facts dspf
      WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
      GROUP BY dspf.fact_date
      ORDER BY dspf.fact_date ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    const evolutionWeekly = await sequelize.query(
      `
      SELECT
        DATE_TRUNC('week', dspf.fact_date)::date AS period,
        SUM(dspf.total_sold) AS total_sold,
        SUM(dspf.orders_count) AS sales_count
      FROM daily_seller_product_facts dspf
      WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
      GROUP BY DATE_TRUNC('week', dspf.fact_date)
      ORDER BY period ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: baseFilterReplacements,
      },
    );

    const evolutionMonthly = await sequelize.query(
      `
      SELECT
        DATE_TRUNC('month', dspf.fact_date)::date AS period,
        SUM(dspf.total_sold) AS total_sold,
        SUM(dspf.orders_count) AS sales_count
      FROM daily_seller_product_facts dspf
      WHERE dspf.fact_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND (CAST(:sellerId AS uuid) IS NULL OR dspf.seller_id = CAST(:sellerId AS uuid))
        AND (CAST(:productId AS uuid) IS NULL OR dspf.product_id = CAST(:productId AS uuid))
        AND (CAST(:brand AS varchar) IS NULL OR dspf.product_brand = CAST(:brand AS varchar))
        AND (CAST(:tireMeasure AS varchar) IS NULL OR dspf.product_measure = CAST(:tireMeasure AS varchar))
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR EXISTS (
          SELECT 1
          FROM orders o_ub
          JOIN order_items oi_ub ON oi_ub.order_id = o_ub.id
          JOIN invoices inv_ub ON inv_ub.id = o_ub.invoice_id
          WHERE DATE(o_ub.date) = dspf.fact_date
            AND inv_ub.seller_id = dspf.seller_id
            AND oi_ub.product_id = dspf.product_id
            AND o_ub.unit_business_id = CAST(:unitBusinessId AS uuid)
        ))
      GROUP BY DATE_TRUNC('month', dspf.fact_date)
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
          SELECT
            s.*,
            ct.name AS seller_name
          FROM seller_sales_order_item_snapshots s
          LEFT JOIN contacts ct ON ct.id = s.seller_id
          WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
            AND s.is_valid_sale = TRUE
            AND (CAST(:sellerId AS uuid) IS NULL OR s.seller_id = CAST(:sellerId AS uuid))
            AND (CAST(:productId AS uuid) IS NULL OR s.product_id = CAST(:productId AS uuid))
            AND (CAST(:brand AS varchar) IS NULL OR s.product_brand = CAST(:brand AS varchar))
            AND (CAST(:tireMeasure AS varchar) IS NULL OR s.product_measure = CAST(:tireMeasure AS varchar))
            AND (CAST(:customerId AS uuid) IS NULL OR s.customer_id = CAST(:customerId AS uuid))
            AND (CAST(:unitBusinessId AS uuid) IS NULL OR s.unit_business_id = CAST(:unitBusinessId AS uuid))
          ORDER BY s.order_date DESC, s.last_updated_at DESC
          `,
          {
            type: QueryTypes.SELECT,
            replacements: baseFilterReplacements,
          },
        )
      : undefined;

    return {
      filters,
      summary,
      products,
      ranking: ranking[0],
      byStore,
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