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

export class SalesReportRepository {
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

    return rows.map((row) => row.order_id);
  }

  async upsertSnapshots(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    await sequelize.query(
      `
      WITH affected(order_id) AS (
        SELECT unnest(ARRAY[:orderIds]::uuid[])
      ),

      -- ------------------------------------------------------------------
      -- 1. Fonte de dados do pedido
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
            WHEN COALESCE(iosm.is_cancelled, FALSE)             THEN 'cancelled'
            WHEN COALESCE(iosm.is_final, FALSE)
              OR o.internal_status::text = 'EMITTED'            THEN 'completed'
            ELSE 'open'
          END                                                   AS snapshot_status,
          COALESCE(o.total_products, o.total_price, 0)          AS total_products,
          COALESCE(o.total_order,    o.total_price, 0)          AS total_order,
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
          COALESCE(o.approx_tax_value, 0)                       AS approx_tax_value,
          FALSE                                                 AS has_invoice_data,
          o.source_payload
        FROM orders o
        JOIN affected a ON a.order_id = o.id
        LEFT JOIN integration_order_status_mappings iosm ON (
          iosm.integration_id     = o.integrations_id
          AND iosm.external_status_id = o.actual_situation
        )
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
          ibs_value, cbs_value, approx_tax_value,
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
          ibs_value, cbs_value, approx_tax_value,
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
          tax_commission,
          marketplace_fee,
          payment_fee
      ),

      -- ------------------------------------------------------------------
      -- 3. Fonte de dados dos itens
      --    Usa inserted_orders (io) via RETURNING — alias io em todo lugar.
      -- ------------------------------------------------------------------
      item_source AS (
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
          oi.sku,
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
          COALESCE(
            oi.net_total,
            (COALESCE(oi.unit_price, oi.price, 0)::numeric
              * COALESCE(oi.quantity, 0)::numeric)
              - COALESCE(oi.discount_value, 0)
          )                                                     AS net_total,
          CASE
            WHEN st.quantity > 0
              THEN ROUND((st.total_price::numeric / st.quantity::numeric), 4)
            WHEN p.supplier_cost_price IS NOT NULL
              THEN p.supplier_cost_price
            ELSE 0
          END                                                   AS average_cost_snapshot,
          CASE
            WHEN st.quantity > 0               THEN 'STOCK_AVERAGE'
            WHEN p.supplier_cost_price IS NOT NULL THEN 'PRODUCT_SUPPLIER_COST'
            ELSE 'UNKNOWN'
          END                                                   AS cost_source,
          COALESCE(oi.commission_base, 0)                       AS commission_base,
          COALESCE(oi.commission_rate, 0)                       AS commission_rate,
          COALESCE(oi.commission_value, 0)                      AS commission_value,
          p.ncm,
          p.cest,
          NULL::varchar                                         AS cfop,
          COALESCE(p.gtin, p.ean)                               AS gtin,
          0::numeric                                            AS approx_tax_value,
          0::numeric                                            AS icms_rate,
          0::numeric                                            AS icms_value,
          0::numeric                                            AS ipi_value,
          0::numeric                                            AS pis_value,
          0::numeric                                            AS cofins_value,
          0::numeric                                            AS difal_value,
          0::numeric                                            AS ibs_value,
          0::numeric                                            AS cbs_value,
          oi.source_payload
        FROM order_items oi
        JOIN inserted_orders io ON io.order_id = oi.order_id
        LEFT JOIN products p ON (
          p.id = oi.product_id OR p.sku = oi.sku OR p.id_system = oi.sku
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
      -- 4. Upsert dos snapshots de item
      --    RETURNING expande os campos necessários para item_totals.
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
          net_total, average_cost_snapshot,
          ROUND((average_cost_snapshot * quantity)::numeric, 2),
          cost_source,
          CASE
            WHEN (average_cost_snapshot * quantity) = 0 THEN 0
            ELSE ROUND(
              ((net_total - (average_cost_snapshot * quantity))
                / (average_cost_snapshot * quantity) * 100)::numeric, 2
            )
          END,
          commission_base, commission_rate, commission_value,
          ncm, cest, cfop, gtin,
          approx_tax_value, icms_rate, icms_value, ipi_value, pis_value,
          cofins_value, difal_value, ibs_value, cbs_value,
          source_payload, NOW(), NOW(), NOW()
        FROM item_source
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
          cost_source
      ),

      -- ------------------------------------------------------------------
      -- 5. Agrega totais dos itens via inserted_items (RETURNING)
      -- ------------------------------------------------------------------
      item_totals AS (
        SELECT
          ii.order_snapshot_id,
          SUM(ii.quantity)                                          AS items_quantity,
          SUM(ii.total_cost_snapshot)                               AS total_cost,
          BOOL_OR(ii.cost_source IS DISTINCT FROM 'STOCK_AVERAGE') AS has_cost_fallback
        FROM inserted_items ii
        GROUP BY ii.order_snapshot_id
      )

      -- ------------------------------------------------------------------
      -- 6. Atualiza campos derivados no snapshot do pedido
      -- ------------------------------------------------------------------
      UPDATE sales_order_snapshots sos
      SET
        items_quantity    = COALESCE(it.items_quantity, 0),
        total_cost        = COALESCE(it.total_cost, 0),

        total_taxes       = COALESCE(sos.icms_value,   0)
                          + COALESCE(sos.ipi_value,    0)
                          + COALESCE(sos.pis_value,    0)
                          + COALESCE(sos.cofins_value, 0)
                          + COALESCE(sos.difal_value,  0)
                          + COALESCE(sos.ibs_value,    0)
                          + COALESCE(sos.cbs_value,    0),

        total_fees        = COALESCE(sos.tax_commission,  0)
                          + COALESCE(sos.marketplace_fee, 0)
                          + COALESCE(sos.payment_fee,     0),

        contribution_value =
          COALESCE(sos.total_order, 0)
          - COALESCE(it.total_cost, 0)
          - CASE WHEN sos.freight_paid_by_company
              THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
          - (  COALESCE(sos.icms_value,   0) + COALESCE(sos.ipi_value,    0)
             + COALESCE(sos.pis_value,    0) + COALESCE(sos.cofins_value, 0)
             + COALESCE(sos.difal_value,  0) + COALESCE(sos.ibs_value,    0)
             + COALESCE(sos.cbs_value,    0))
          - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
             + COALESCE(sos.payment_fee,     0)),

        contribution_pct  =
          CASE WHEN COALESCE(sos.total_order, 0) = 0 THEN 0
          ELSE ROUND(((
            COALESCE(sos.total_order, 0)
            - COALESCE(it.total_cost, 0)
            - CASE WHEN sos.freight_paid_by_company
                THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
            - (  COALESCE(sos.icms_value,   0) + COALESCE(sos.ipi_value,    0)
               + COALESCE(sos.pis_value,    0) + COALESCE(sos.cofins_value, 0)
               + COALESCE(sos.difal_value,  0) + COALESCE(sos.ibs_value,    0)
               + COALESCE(sos.cbs_value,    0))
            - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
               + COALESCE(sos.payment_fee,     0))
          ) / sos.total_order * 100)::numeric, 2)
          END,

        markup_pct        =
          CASE WHEN COALESCE(it.total_order, 0) = 0 THEN 0
          ELSE ROUND((
            (COALESCE(sos.total_order, 0) - it.total_cost) / it.total_order * 100
          )::numeric, 2)
          END,

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
  // Helpers para buscar chaves afetadas (usadas para recalcular facts)
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
  // Upsert das tabelas de facts
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
            COALESCE(SUM(total_order),       0) AS total_value,
            COALESCE(SUM(freight_charged),   0) AS total_freight,
            COALESCE(SUM(total_cost),        0) AS total_cost,
            COALESCE(SUM(total_taxes),       0) AS total_taxes,
            COALESCE(SUM(total_fees),        0) AS total_fees,
            COALESCE(SUM(contribution_value),0) AS contribution_value
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND snapshot_status <> 'cancelled'
        )
        INSERT INTO daily_sales_facts (
          fact_date, unit_business_id,
          orders_count, items_quantity,
          total_value, total_freight, average_freight, average_ticket,
          total_cost, total_taxes, total_fees,
          contribution_value, contribution_pct, markup_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id,
          orders_count, items_quantity,
          total_value, total_freight,
          CASE WHEN orders_count = 0 THEN 0
            ELSE ROUND((total_freight / orders_count)::numeric, 2) END,
          CASE WHEN orders_count = 0 THEN 0
            ELSE ROUND((total_value  / orders_count)::numeric, 2) END,
          total_cost, total_taxes, total_fees,
          contribution_value,
          CASE WHEN total_value = 0 THEN 0
            ELSE ROUND((contribution_value / total_value * 100)::numeric, 2) END,
          CASE WHEN total_value = 0 THEN 0
            ELSE ROUND(((total_value - total_cost) / total_value * 100)::numeric, 2)
 END,
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
            COALESCE(SUM(total_order),    0) AS total_value,
            COALESCE(SUM(freight_charged),0) AS total_freight
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND destination_uf   = :destinationUf
            AND snapshot_status <> 'cancelled'
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
          CASE WHEN orders_count = 0 THEN 0
            ELSE ROUND((total_freight / orders_count)::numeric, 2) END,
          CASE WHEN orders_count = 0 THEN 0
            ELSE ROUND((total_value  / orders_count)::numeric, 2) END,
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
            COALESCE(SUM(total_order),     0) AS total_value,
            COALESCE(SUM(freight_charged), 0) AS total_freight,
            COALESCE(SUM(total_cost),      0) AS total_cost,
            COALESCE(SUM(total_taxes),     0) AS total_taxes,
            COALESCE(SUM(total_fees),      0) AS total_fees,
            COALESCE(SUM(contribution_value),0) AS contribution_value
          FROM sales_order_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND store_id         = :storeId
            AND snapshot_status <> 'cancelled'
        )
        INSERT INTO daily_sales_store_facts (
          fact_date, unit_business_id, store_id,
          orders_count, items_quantity, total_value, total_freight,
          average_ticket, total_cost, piece_average_value, markup_pct,
          total_taxes, total_fees, contribution_value, contribution_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, store_id,
          orders_count, items_quantity, total_value, total_freight,
          CASE WHEN orders_count  = 0 THEN 0
            ELSE ROUND((total_value / orders_count)::numeric, 2) END,
          total_cost,
          CASE WHEN items_quantity = 0 THEN 0
            ELSE ROUND((total_value / items_quantity)::numeric, 2) END,
          CASE WHEN total_cost     = 0 THEN 0
            ELSE ROUND(((total_value - total_cost) / total_value * 100)::numeric, 2)
 END,
          total_taxes, total_fees, contribution_value,
          CASE WHEN total_value    = 0 THEN 0
            ELSE ROUND((contribution_value / total_value * 100)::numeric, 2) END,
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
            COALESCE(SUM(net_total),          0) AS total_value
          FROM sales_order_item_snapshots
          WHERE order_date       = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND sku              = :sku
        )
        INSERT INTO daily_sales_product_facts (
          fact_date, unit_business_id, product_id, sku, description,
          quantity, total_cost, total_value, markup_pct,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, product_id, sku, description,
          quantity, total_cost, total_value,
          CASE WHEN total_value = 0 THEN 0
            ELSE ROUND(((total_value - total_cost) / total_value * 100)::numeric, 2)
 END,
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id, sku) DO UPDATE SET
          product_id      = EXCLUDED.product_id,
          description     = EXCLUDED.description,
          quantity        = EXCLUDED.quantity,
          total_cost      = EXCLUDED.total_cost,
          total_value     = EXCLUDED.total_value,
          markup_pct      = EXCLUDED.markup_pct,
          last_updated_at = NOW(),
          updated_at      = NOW()
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
    for (const key of keys) {
      await sequelize.query(
        `
        WITH metrics AS (
          SELECT
            CAST(:factDate AS date)            AS fact_date,
            CAST(:unitBusinessId AS uuid)      AS unit_business_id,
            CAST(:integrationId AS uuid)       AS integration_id,
            CAST(:statusNormalized AS varchar) AS status_normalized,
            COALESCE(
              MAX(iosm.display_name),
              :statusNormalized
            )                                  AS status_display_name,
            COUNT(sos.*)::integer              AS orders_count,
            COALESCE(SUM(sos.total_order), 0)  AS total_value
          FROM sales_order_snapshots sos
          LEFT JOIN integration_order_status_mappings iosm ON (
            iosm.integration_id    = sos.integration_id
            AND iosm.normalized_status = sos.status_snapshot
          )
          WHERE sos.order_date       = CAST(:factDate AS date)
            AND sos.unit_business_id = :unitBusinessId
            AND sos.integration_id   = :integrationId
            AND sos.status_snapshot  = :statusNormalized
        )
        INSERT INTO daily_sales_status_facts (
          fact_date, unit_business_id, integration_id,
          status_normalized, status_display_name,
          orders_count, total_value,
          last_updated_at, created_at, updated_at
        )
        SELECT
          fact_date, unit_business_id, integration_id,
          status_normalized, status_display_name,
          orders_count, total_value,
          NOW(), NOW(), NOW()
        FROM metrics
        ON CONFLICT (fact_date, unit_business_id, integration_id, status_normalized)
        DO UPDATE SET
          status_display_name = EXCLUDED.status_display_name,
          orders_count        = EXCLUDED.orders_count,
          total_value         = EXCLUDED.total_value,
          last_updated_at     = NOW(),
          updated_at          = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            integrationId: key.integration_id,
            statusNormalized: key.status_normalized,
          },
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Consulta do relatório
  // ---------------------------------------------------------------------------

  async getReport(filters: SalesReportFilters) {
    const replacements = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    unitBusinessId: filters.unitBusinessId ?? null,
    storeId: filters.storeId ?? null,
    state: filters.state ?? null,
    productId: filters.productId ?? null,
    sku: filters.sku ?? null,
    statusNormalized: filters.statusId ?? null,
  };

    const unitFilter =
    "(:unitBusinessId IS NULL OR unit_business_id = CAST(:unitBusinessId AS uuid))";

    const [general] = await sequelize.query<ReportRow>(
      `
      SELECT
        COALESCE(SUM(orders_count),    0)::integer AS orders_count,
        COALESCE(SUM(items_quantity),  0) AS items_quantity,
        COALESCE(SUM(total_value),     0) AS total_value,
        COALESCE(SUM(total_freight),   0) AS total_freight,
        CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_value)   / SUM(orders_count))::numeric, 2)
        END AS average_ticket,
        CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_freight) / SUM(orders_count))::numeric, 2)
        END AS average_freight,
        COALESCE(SUM(total_cost),        0) AS total_cost,
        COALESCE(SUM(total_taxes),       0) AS total_taxes,
        COALESCE(SUM(total_fees),        0) AS total_fees,
        COALESCE(SUM(contribution_value),0) AS contribution_value,
        CASE WHEN COALESCE(SUM(total_value), 0) = 0 THEN 0
          ELSE ROUND((SUM(contribution_value) / SUM(total_value) * 100)::numeric, 2)
        END AS contribution_pct,
        CASE WHEN COALESCE(SUM(total_value), 0) = 0 THEN 0
  ELSE ROUND(((SUM(total_value) - SUM(total_cost)) / SUM(total_value) * 100)::numeric, 2)
END AS markup_pct
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
        CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_freight) / SUM(orders_count))::numeric, 2)
        END AS average_freight,
        CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_value)   / SUM(orders_count))::numeric, 2)
        END AS average_ticket
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
      COALESCE(SUM(total_value),0) AS total_value,
      CASE WHEN COALESCE(SUM(total_value), 0) = 0 THEN 0
  ELSE ROUND(((SUM(total_value) - SUM(total_cost)) / SUM(total_value) * 100)::numeric, 2)
END AS markup_pct
    FROM daily_sales_product_facts
    WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND ${unitFilter}
      AND (:productId IS NULL OR product_id = CAST(:productId AS uuid))
      AND (:sku IS NULL OR sku = :sku)
    GROUP BY product_id, sku
    ORDER BY quantity DESC          -- ✅ era total_value DESC
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
      CASE WHEN COALESCE(SUM(dsf.orders_count), 0) = 0 THEN 0
        ELSE ROUND((SUM(dsf.total_value) / SUM(dsf.orders_count))::numeric, 2)
      END AS average_ticket,
      COALESCE(SUM(dsf.total_cost),         0) AS total_cost,
      CASE WHEN COALESCE(SUM(dsf.items_quantity), 0) = 0 THEN 0
        ELSE ROUND((SUM(dsf.total_value) / SUM(dsf.items_quantity))::numeric, 2)
      END AS piece_average_value,
      CASE WHEN COALESCE(SUM(dsf.total_value), 0) = 0 THEN 0
  ELSE ROUND(((SUM(dsf.total_value) - SUM(dsf.total_cost)) / SUM(dsf.total_value) * 100)::numeric, 2)
END AS markup_pct,
      COALESCE(SUM(dsf.total_taxes),        0) AS total_taxes,
      COALESCE(SUM(dsf.total_fees),         0) AS total_fees,
      COALESCE(SUM(dsf.contribution_value), 0) AS contribution_value,
      CASE WHEN COALESCE(SUM(dsf.total_value), 0) = 0 THEN 0
        ELSE ROUND((SUM(dsf.contribution_value) / SUM(dsf.total_value) * 100)::numeric, 2)
      END AS contribution_pct
    FROM daily_sales_facts dsf                    -- ✅ era daily_sales_store_facts
    LEFT JOIN unit_businesses ub ON ub.id = dsf.unit_business_id
    WHERE dsf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND (:unitBusinessId IS NULL OR dsf.unit_business_id = CAST(:unitBusinessId AS uuid))
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
      -- ✅ usa display_name da tabela de mapeamento; fallback para status_normalized
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
    -- ✅ JOIN direto na tabela de mapeamento para garantir display_name correto
    LEFT JOIN integration_order_status_mappings iosm 
  ON iosm.normalized_status = dssf.status_normalized
 AND (:unitBusinessId IS NULL 
      OR iosm.unit_business_id = CAST(:unitBusinessId AS uuid))
    WHERE dssf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
      AND (:unitBusinessId IS NULL OR dssf.unit_business_id = CAST(:unitBusinessId AS uuid))
      AND (:statusNormalized IS NULL OR dssf.status_normalized = :statusNormalized)
    GROUP BY dssf.status_normalized, total.orders_count
    ORDER BY orders_count DESC
    `,
    { type: QueryTypes.SELECT, replacements },
  );

    const orders = filters.drillDown
      ? await sequelize.query<ReportRow>(
          `
          SELECT *
          FROM sales_order_snapshots
          WHERE order_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
            AND (:storeId IS NULL OR store_id = CAST(:storeId AS uuid))
            AND (:state IS NULL OR destination_uf = :state)
            AND (:statusNormalized IS NULL OR status_snapshot = :statusNormalized)
          ORDER BY order_date DESC, updated_at DESC
          LIMIT 500
          `,
          { type: QueryTypes.SELECT, replacements },
        )
      : [];

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
      orders,
    };
  }

  async updateSnapshotTotals(orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;

  await sequelize.query(
    `
    WITH item_totals AS (
      SELECT
        sois.order_snapshot_id,
        SUM(sois.quantity)                                           AS items_quantity,
        SUM(sois.total_cost_snapshot)                                AS total_cost,
        BOOL_OR(sois.cost_source IS DISTINCT FROM 'STOCK_AVERAGE')  AS has_cost_fallback
      FROM sales_order_item_snapshots sois
      WHERE sois.order_id IN (:orderIds)
      GROUP BY sois.order_snapshot_id
    )
    UPDATE sales_order_snapshots sos
    SET
      items_quantity    = COALESCE(it.items_quantity, 0),
      total_cost        = COALESCE(it.total_cost, 0),

      total_taxes       = COALESCE(sos.icms_value,   0)
                        + COALESCE(sos.ipi_value,    0)
                        + COALESCE(sos.pis_value,    0)
                        + COALESCE(sos.cofins_value, 0)
                        + COALESCE(sos.difal_value,  0)
                        + COALESCE(sos.ibs_value,    0)
                        + COALESCE(sos.cbs_value,    0),

      total_fees        = COALESCE(sos.tax_commission,  0)
                        + COALESCE(sos.marketplace_fee, 0)
                        + COALESCE(sos.payment_fee,     0),

      contribution_value =
        COALESCE(sos.total_order, 0)
        - COALESCE(it.total_cost, 0)
        - CASE WHEN sos.freight_paid_by_company
            THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
        - (  COALESCE(sos.icms_value,   0) + COALESCE(sos.ipi_value,    0)
           + COALESCE(sos.pis_value,    0) + COALESCE(sos.cofins_value, 0)
           + COALESCE(sos.difal_value,  0) + COALESCE(sos.ibs_value,    0)
           + COALESCE(sos.cbs_value,    0))
        - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
           + COALESCE(sos.payment_fee,     0)),

      contribution_pct  =
        CASE WHEN COALESCE(sos.total_order, 0) = 0 THEN 0
        ELSE ROUND(((
          COALESCE(sos.total_order, 0)
          - COALESCE(it.total_cost, 0)
          - CASE WHEN sos.freight_paid_by_company
              THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
          - (  COALESCE(sos.icms_value,   0) + COALESCE(sos.ipi_value,    0)
             + COALESCE(sos.pis_value,    0) + COALESCE(sos.cofins_value, 0)
             + COALESCE(sos.difal_value,  0) + COALESCE(sos.ibs_value,    0)
             + COALESCE(sos.cbs_value,    0))
          - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
             + COALESCE(sos.payment_fee,     0))
        ) / sos.total_order * 100)::numeric, 2)
        END,

      markup_pct = CASE WHEN COALESCE(sos.total_order, 0) = 0 THEN 0
  ELSE ROUND((
    (COALESCE(sos.total_order, 0) - it.total_cost) / sos.total_order * 100
  )::numeric, 2) END,

      has_cost_fallback = COALESCE(it.has_cost_fallback, FALSE),
      last_updated_at   = NOW(),
      updated_at        = NOW()

    FROM item_totals it
    WHERE sos.id = it.order_snapshot_id
    `,
    { replacements: { orderIds } },
  );
}
}

export const salesReportRepository = new SalesReportRepository();
