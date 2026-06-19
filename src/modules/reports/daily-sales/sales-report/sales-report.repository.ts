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
import { loadSql } from "./sales-report.sql-loader";

const JOB_NAME = "sales_report";

// ---------------------------------------------------------------------------
// Row types (internal to repository)
// ---------------------------------------------------------------------------

interface CheckpointRow {
  status: string;
  last_run_at: Date;
  last_processed_at: Date;
  rows_processed: number;
  metadata: { error?: string } | null;
}

interface OrderIdRow {
  order_id: string;
}

type ReportRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SalesReportRepository {
  // -------------------------------------------------------------------------
  // Checkpoint management
  // -------------------------------------------------------------------------

  async getCheckpoint(): Promise<Date> {
    await this.ensureCheckpoint();

    const rows = await sequelize.query<{ last_processed_at: Date }>(
      `SELECT last_processed_at
       FROM report_job_checkpoints
       WHERE job_name = :jobName
       LIMIT 1`,
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
      `INSERT INTO report_job_checkpoints (
         job_name, last_processed_at, last_run_at,
         status, rows_processed, created_at, updated_at
       )
       VALUES (
         :jobName,
         NOW() - INTERVAL '1 day',
         NOW(), 'success', 0, NOW(), NOW()
       )
       ON CONFLICT (job_name) DO NOTHING`,
      { replacements: { jobName: JOB_NAME } },
    );
  }

  async markRunning(): Promise<void> {
    await sequelize.query(
      `UPDATE report_job_checkpoints
       SET status = 'running', last_run_at = NOW(), updated_at = NOW()
       WHERE job_name = :jobName AND status != 'running'`,
      { replacements: { jobName: JOB_NAME } },
    );
  }

  async markSuccess(jobStartTime: Date, rowsProcessed: number): Promise<void> {
    await sequelize.query(
      `UPDATE report_job_checkpoints
       SET last_processed_at = :jobStartTime,
           last_run_at       = NOW(),
           status            = 'success',
           rows_processed    = :rowsProcessed,
           metadata          = NULL,
           updated_at        = NOW()
       WHERE job_name = :jobName`,
      { replacements: { jobName: JOB_NAME, jobStartTime, rowsProcessed } },
    );
  }

  async markFailed(error: Error): Promise<void> {
    await sequelize.query(
      `UPDATE report_job_checkpoints
       SET status     = 'failed',
           metadata   = CAST(:metadata AS jsonb),
           updated_at = NOW()
       WHERE job_name = :jobName`,
      {
        replacements: {
          jobName: JOB_NAME,
          metadata: JSON.stringify({ error: error.message }),
        },
      },
    );
  }

  async getJobStatus(): Promise<CheckpointRow | null> {
    const rows = await sequelize.query<CheckpointRow>(
      `SELECT status, last_run_at, last_processed_at, rows_processed, metadata
       FROM report_job_checkpoints
       WHERE job_name = :jobName
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { jobName: JOB_NAME } },
    );

    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Affected IDs discovery
  // -------------------------------------------------------------------------

  async findAffectedOrderIds(lastProcessedAt: Date): Promise<string[]> {
    const rows = await sequelize.query<OrderIdRow>(
      `SELECT DISTINCT order_id
       FROM (
         SELECT o.id  AS order_id FROM orders o      WHERE o.updated_at  >= :lastProcessedAt
         UNION
         SELECT oi.order_id        FROM order_items oi WHERE oi.updated_at >= :lastProcessedAt
       ) affected
       WHERE order_id IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { lastProcessedAt } },
    );

    return [...new Set(rows.map((r) => r.order_id))];
  }

  async findAffectedFactKeys(orderIds: string[]): Promise<SalesFactKey[]> {
    if (!orderIds.length) return [];
    return sequelize.query<SalesFactKey>(
      `SELECT DISTINCT order_date AS fact_date, unit_business_id
       FROM sales_order_snapshots
       WHERE order_id = ANY(ARRAY[:orderIds]::uuid[])
         AND unit_business_id IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStateFactKeys(orderIds: string[]): Promise<SalesStateFactKey[]> {
    if (!orderIds.length) return [];
    return sequelize.query<SalesStateFactKey>(
      `SELECT DISTINCT order_date AS fact_date, unit_business_id, destination_uf
       FROM sales_order_snapshots
       WHERE order_id = ANY(ARRAY[:orderIds]::uuid[])
         AND unit_business_id IS NOT NULL
         AND destination_uf IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStoreFactKeys(orderIds: string[]): Promise<SalesStoreFactKey[]> {
    if (!orderIds.length) return [];
    return sequelize.query<SalesStoreFactKey>(
      `SELECT DISTINCT order_date AS fact_date, unit_business_id, store_id
       FROM sales_order_snapshots
       WHERE order_id = ANY(ARRAY[:orderIds]::uuid[])
         AND unit_business_id IS NOT NULL
         AND store_id IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedProductFactKeys(orderIds: string[]): Promise<SalesProductFactKey[]> {
    if (!orderIds.length) return [];
    return sequelize.query<SalesProductFactKey>(
      `SELECT DISTINCT order_date AS fact_date, unit_business_id, sku
       FROM sales_order_item_snapshots
       WHERE order_id = ANY(ARRAY[:orderIds]::uuid[])
         AND unit_business_id IS NOT NULL
         AND sku IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  async findAffectedStatusFactKeys(orderIds: string[]): Promise<SalesStatusFactKey[]> {
    if (!orderIds.length) return [];
    return sequelize.query<SalesStatusFactKey>(
      `SELECT DISTINCT
         order_date       AS fact_date,
         unit_business_id,
         integration_id,
         status_snapshot  AS status_normalized
       FROM sales_order_snapshots
       WHERE order_id = ANY(ARRAY[:orderIds]::uuid[])
         AND unit_business_id IS NOT NULL
         AND status_snapshot IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: { orderIds } },
    );
  }

  // -------------------------------------------------------------------------
  // Heavy upserts — SQL loaded from ./sql/*.sql
  // -------------------------------------------------------------------------

  async upsertSnapshots(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;
    await sequelize.query(loadSql("upsert-order-snapshots"), { replacements: { orderIds } });
  }

  async updateSnapshotTotals(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;
    await sequelize.query(loadSql("update-snapshot-totals"), { replacements: { orderIds } });
  }

  async upsertDailySalesFacts(keys: SalesFactKey[]): Promise<void> {
    if (!keys.length) return;
    const sql = loadSql("upsert-daily-sales-facts");
    for (const { fact_date, unit_business_id } of keys) {
      await sequelize.query(sql, {
        replacements: { factDate: fact_date, unitBusinessId: unit_business_id },
      });
    }
  }

  async upsertDailySalesStateFacts(keys: SalesStateFactKey[]): Promise<void> {
    if (!keys.length) return;
    const sql = loadSql("upsert-daily-sales-state-facts");
    for (const { fact_date, unit_business_id, destination_uf } of keys) {
      await sequelize.query(sql, {
        replacements: { factDate: fact_date, unitBusinessId: unit_business_id, destinationUf: destination_uf },
      });
    }
  }

  async upsertDailySalesStoreFacts(keys: SalesStoreFactKey[]): Promise<void> {
    if (!keys.length) return;
    const sql = loadSql("upsert-daily-sales-store-facts");
    for (const { fact_date, unit_business_id, store_id } of keys) {
      await sequelize.query(sql, {
        replacements: { factDate: fact_date, unitBusinessId: unit_business_id, storeId: store_id },
      });
    }
  }

  async upsertDailySalesProductFacts(keys: SalesProductFactKey[]): Promise<void> {
    if (!keys.length) return;
    const sql = loadSql("upsert-daily-sales-product-facts");
    for (const { fact_date, unit_business_id, sku } of keys) {
      await sequelize.query(sql, {
        replacements: { factDate: fact_date, unitBusinessId: unit_business_id, sku },
      });
    }
  }

  async upsertDailySalesStatusFacts(keys: SalesStatusFactKey[]): Promise<void> {
    if (!keys.length) return;
    const sql = loadSql("upsert-daily-sales-status-facts");
    for (const { fact_date, unit_business_id, integration_id, status_normalized } of keys) {
      await sequelize.query(sql, {
        replacements: {
          factDate: fact_date,
          unitBusinessId: unit_business_id,
          integrationId: integration_id,
          statusNormalized: status_normalized,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Report read — simple selects, SQL stays inline (no .sql files needed)
  // -------------------------------------------------------------------------

  async getReport(filters: SalesReportFilters) {
    const replacements = {
      dateFrom:        filters.dateFrom,
      dateTo:          filters.dateTo,
      unitBusinessId:  filters.unitBusinessId  ?? null,
      storeId:         filters.storeId         ?? null,
      state:           filters.state           ?? null,
      productId:       filters.productId       ?? null,
      sku:             filters.sku             ?? null,
      statusNormalized: filters.statusId       ?? null,
    };

    const unitFilter =
      "(:unitBusinessId IS NULL OR unit_business_id = CAST(:unitBusinessId AS uuid))";

    const [general] = await sequelize.query<ReportRow>(
      `SELECT
         COALESCE(SUM(orders_count),      0)::integer AS orders_count,
         COALESCE(SUM(items_quantity),    0)           AS items_quantity,
         COALESCE(SUM(total_value),       0)           AS total_value,
         COALESCE(SUM(total_freight),     0)           AS total_freight,
         CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
              ELSE ROUND((SUM(total_value)   / SUM(orders_count))::numeric, 2) END AS average_ticket,
         CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
              ELSE ROUND((SUM(total_freight) / SUM(orders_count))::numeric, 2) END AS average_freight,
         COALESCE(SUM(total_cost),        0)           AS total_cost,
         COALESCE(SUM(total_taxes),       0)           AS total_taxes,
         COALESCE(SUM(total_fees),        0)           AS total_fees,
         COALESCE(SUM(contribution_value),0)           AS contribution_value,
         CASE WHEN COALESCE(SUM(total_value), 0) = 0 THEN 0
              ELSE ROUND((SUM(contribution_value) / NULLIF(SUM(total_value), 0) * 100)::numeric, 2) END AS contribution_pct,
         CASE WHEN SUM(total_value) = 0 THEN 0
              ELSE ROUND(((SUM(total_value) - SUM(total_cost)) / NULLIF(SUM(total_value), 0) * 100)::numeric, 2) END AS markup_pct
       FROM daily_sales_facts
       WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
         AND ${unitFilter}`,
      { type: QueryTypes.SELECT, replacements },
    );

    const byState = await sequelize.query<ReportRow>(
      `SELECT
         destination_uf,
         COALESCE(SUM(orders_count),   0)::integer AS orders_count,
         COALESCE(SUM(items_quantity), 0)           AS items_quantity,
         COALESCE(SUM(total_value),    0)           AS total_value,
         COALESCE(SUM(total_freight),  0)           AS total_freight,
         CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
              ELSE ROUND((SUM(total_freight) / SUM(orders_count))::numeric, 2) END AS average_freight,
         CASE WHEN COALESCE(SUM(orders_count), 0) = 0 THEN 0
              ELSE ROUND((SUM(total_value)   / SUM(orders_count))::numeric, 2) END AS average_ticket
       FROM daily_sales_state_facts
       WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
         AND ${unitFilter}
         AND (:state IS NULL OR destination_uf = :state)
       GROUP BY destination_uf
       ORDER BY total_value DESC`,
      { type: QueryTypes.SELECT, replacements },
    );

    const byProduct = await sequelize.query<ReportRow>(
      `SELECT
         product_id,
         sku,
         MAX(description)           AS description,
         COALESCE(SUM(quantity),    0) AS quantity,
         COALESCE(SUM(total_cost),  0) AS total_cost,
         COALESCE(SUM(total_value), 0) AS total_value,
         CASE WHEN SUM(total_value) = 0 THEN 0
              ELSE ROUND(((SUM(total_value) - SUM(total_cost)) / NULLIF(SUM(total_value), 0) * 100)::numeric, 2) END AS markup_pct
       FROM daily_sales_product_facts
       WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
         AND ${unitFilter}
         AND (:productId IS NULL OR product_id = CAST(:productId AS uuid))
         AND (:sku IS NULL OR sku = :sku)
       GROUP BY product_id, sku
       ORDER BY quantity DESC`,
      { type: QueryTypes.SELECT, replacements },
    );

    const byUnitBusiness = await sequelize.query<ReportRow>(
      `SELECT
         dsf.unit_business_id,
         ub.name                                           AS unit_business_name,
         COALESCE(SUM(dsf.orders_count),       0)::integer AS orders_count,
         COALESCE(SUM(dsf.items_quantity),     0)           AS items_quantity,
         COALESCE(SUM(dsf.total_value),        0)           AS total_value,
         COALESCE(SUM(dsf.total_freight),      0)           AS total_freight,
         CASE WHEN COALESCE(SUM(dsf.orders_count), 0) = 0 THEN 0
              ELSE ROUND((SUM(dsf.total_value) / SUM(dsf.orders_count))::numeric, 2) END AS average_ticket,
         COALESCE(SUM(dsf.total_cost),         0)           AS total_cost,
         CASE WHEN COALESCE(SUM(dsf.items_quantity), 0) = 0 THEN 0
              ELSE ROUND((SUM(dsf.total_value) / SUM(dsf.items_quantity))::numeric, 2) END AS piece_average_value,
         CASE WHEN COALESCE(SUM(dsf.total_value), 0) = 0 THEN 0
              ELSE ROUND(((SUM(dsf.total_value) - SUM(dsf.total_cost)) / NULLIF(SUM(dsf.total_value), 0) * 100)::numeric, 2) END AS markup_pct,
         COALESCE(SUM(dsf.total_taxes),        0)           AS total_taxes,
         COALESCE(SUM(dsf.total_fees),         0)           AS total_fees,
         COALESCE(SUM(dsf.contribution_value), 0)           AS contribution_value,
         CASE WHEN COALESCE(SUM(dsf.total_value), 0) = 0 THEN 0
              ELSE ROUND((SUM(dsf.contribution_value) / NULLIF(SUM(dsf.total_value), 0) * 100)::numeric, 2) END AS contribution_pct
       FROM daily_sales_facts dsf
       LEFT JOIN unit_businesses ub ON ub.id = dsf.unit_business_id
       WHERE dsf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
         AND (:unitBusinessId IS NULL OR dsf.unit_business_id = CAST(:unitBusinessId AS uuid))
       GROUP BY dsf.unit_business_id, ub.name
       ORDER BY total_value DESC`,
      { type: QueryTypes.SELECT, replacements },
    );

    const byStatus = await sequelize.query<ReportRow>(
      `WITH total AS (
         SELECT COALESCE(SUM(orders_count), 0)::integer AS orders_count
         FROM daily_sales_status_facts
         WHERE fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
           AND ${unitFilter}
       )
       SELECT
         dssf.status_normalized,
         COALESCE(MAX(iosm.display_name), MAX(dssf.status_display_name), dssf.status_normalized) AS status_display_name,
         COALESCE(SUM(dssf.orders_count), 0)::integer AS orders_count,
         total.orders_count                            AS total_orders_count,
         COALESCE(SUM(dssf.total_value),  0)           AS total_value
       FROM daily_sales_status_facts dssf
       CROSS JOIN total
       LEFT JOIN integration_order_status_mappings iosm
         ON iosm.normalized_status = dssf.status_normalized
       WHERE dssf.fact_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
         AND (:unitBusinessId IS NULL OR dssf.unit_business_id = CAST(:unitBusinessId AS uuid))
         AND (:statusNormalized IS NULL OR dssf.status_normalized = :statusNormalized)
       GROUP BY dssf.status_normalized, total.orders_count
       ORDER BY orders_count DESC`,
      { type: QueryTypes.SELECT, replacements },
    );

    return {
      period: { dateFrom: filters.dateFrom, dateTo: filters.dateTo },
      general: general ?? {},
      byState,
      byProduct,
      byUnitBusiness,
      byStatus,
    };
  }
}

export const salesReportRepository = new SalesReportRepository();