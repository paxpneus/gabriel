import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  AffectedFactKey,
  AffectedTransporterFactKey,
  DailyOperationReportFilters,
} from "./daily-operation-report.types";

const JOB_NAME = "daily_operation_report";

interface CheckpointRow {
  last_processed_at: Date;
}

interface InvoiceIdRow {
  invoice_id: string;
}

export class DailyOperationReportRepository {
  async getCheckpoint(): Promise<Date> {
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
      throw new Error("Checkpoint daily_operation_report não encontrado.");
    }

    return rows[0].last_processed_at;
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

  async findAffectedInvoiceIds(lastProcessedAt: Date): Promise<string[]> {
    const rows = await sequelize.query<InvoiceIdRow>(
      `
      SELECT DISTINCT invoice_id
      FROM (
        SELECT i.id AS invoice_id
        FROM invoices i
        WHERE i.updated_at >= :lastProcessedAt

        UNION

        SELECT ii.invoice_id
        FROM invoice_items ii
        WHERE ii.updated_at >= :lastProcessedAt

        UNION

        SELECT ii.invoice_id
        FROM entrance_scan_logs esl
        JOIN invoice_items ii ON ii.id = esl.invoice_items_id
        WHERE esl.created_at >= :lastProcessedAt

        UNION

        SELECT ebi.invoice_id
        FROM expedition_batch_invoices ebi
        WHERE ebi.created_at >= :lastProcessedAt

        UNION

        SELECT ebi.invoice_id
        FROM expedition_scan_logs esl
        JOIN expedition_batch_invoices ebi ON ebi.id = esl.expedition_batch_invoices_id
        WHERE esl.created_at >= :lastProcessedAt

        UNION

        SELECT ebi.invoice_id
        FROM expedition_batches eb
        JOIN expedition_batch_invoices ebi ON ebi.expedition_batch_id = eb.id
        WHERE eb.updated_at >= :lastProcessedAt
      ) affected
      WHERE invoice_id IS NOT NULL
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { lastProcessedAt },
      },
    );

    return rows.map((row) => row.invoice_id);
  }

  async upsertSnapshots(invoiceIds: string[]): Promise<void> {
    if (!invoiceIds.length) return;

    await sequelize.query(
      `
      WITH affected(invoice_id) AS (
        SELECT unnest(ARRAY[:invoiceIds]::uuid[])
      ),
      item_totals AS (
        SELECT
          ii.invoice_id,
          COALESCE(SUM(ii.quantity_expected), 0)::integer AS total_expected,
          COALESCE(SUM(ii.quantity_received), 0)::integer AS total_received
        FROM invoice_items ii
        JOIN affected a ON a.invoice_id = ii.invoice_id
        GROUP BY ii.invoice_id
      ),
      scan_bounds AS (
        SELECT
          ii.invoice_id,
          MIN(esl.created_at) AS first_scan_at,
          MAX(esl.created_at) AS last_scan_at
        FROM entrance_scan_logs esl
        JOIN invoice_items ii ON ii.id = esl.invoice_items_id
        JOIN affected a ON a.invoice_id = ii.invoice_id
        GROUP BY ii.invoice_id
      ),
      batch_data AS (
        SELECT DISTINCT ON (ebi.invoice_id)
          ebi.invoice_id,
          eb.delivery_note_generated_at,
          eb.created_at AS batch_created_at,
          eb.transporters_id AS batch_transporter_id
        FROM expedition_batch_invoices ebi
        JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
        JOIN affected a ON a.invoice_id = ebi.invoice_id
        ORDER BY ebi.invoice_id, ebi.created_at ASC
      ),
      snapshot_source AS (
        SELECT
          i.id AS invoice_id,
          i.unit_business_id,
          COALESCE(i.transporter_id, bd.batch_transporter_id) AS transporter_id,
          i.type,
          CASE
            WHEN i.type = 'OUTGOING' THEN DATE(COALESCE(i.emitted_at, i.created_at))
            ELSE DATE(i.created_at)
          END AS invoice_date,
          i.emitted_at,
          bd.delivery_note_generated_at,
          sb.first_scan_at,
          sb.last_scan_at,
          COALESCE(it.total_expected, 0) AS total_items_expected,
          COALESCE(it.total_received, 0) AS total_items_received,
          CASE
            WHEN COALESCE(it.total_expected, 0) = 0 THEN 0
            ELSE ROUND((COALESCE(it.total_received, 0)::numeric / it.total_expected::numeric) * 100, 2)
          END AS scan_completion_pct,
          CASE
            WHEN i.type = 'INCOMING'
              AND COALESCE(it.total_expected, 0) > 0
              AND COALESCE(it.total_received, 0) = COALESCE(it.total_expected, 0)
              THEN sb.last_scan_at
            WHEN i.type = 'OUTGOING' AND bd.delivery_note_generated_at IS NOT NULL
              THEN bd.delivery_note_generated_at
            ELSE NULL
          END AS fully_processed_at,
          CASE
            WHEN i.type = 'OUTGOING'
              AND i.emitted_at IS NOT NULL
              AND bd.delivery_note_generated_at IS NOT NULL
              THEN ROUND((EXTRACT(EPOCH FROM (bd.delivery_note_generated_at - i.emitted_at)) / 60)::numeric, 2)
            ELSE NULL
          END AS minutes_emission_to_delivery_note,
          CASE
            WHEN i.type = 'INCOMING'
              AND bd.batch_created_at IS NOT NULL
              AND COALESCE(it.total_expected, 0) > 0
              AND COALESCE(it.total_received, 0) = COALESCE(it.total_expected, 0)
              AND sb.last_scan_at IS NOT NULL
              THEN ROUND((EXTRACT(EPOCH FROM (sb.last_scan_at - bd.batch_created_at)) / 60)::numeric, 2)
            ELSE NULL
          END AS minutes_batch_to_fully_scanned,
          CASE
            WHEN i.status = 'CANCELLED' THEN 'cancelled'
            WHEN i.status = 'FINISHED' THEN 'completed'
            ELSE 'open'
          END AS snapshot_status
        FROM invoices i
        JOIN affected a ON a.invoice_id = i.id
        LEFT JOIN item_totals it ON it.invoice_id = i.id
        LEFT JOIN scan_bounds sb ON sb.invoice_id = i.id
        LEFT JOIN batch_data bd ON bd.invoice_id = i.id
      )
      INSERT INTO invoice_operation_snapshots (
        invoice_id,
        unit_business_id,
        transporter_id,
        type,
        invoice_date,
        emitted_at,
        delivery_note_generated_at,
        first_scan_at,
        last_scan_at,
        fully_processed_at,
        total_items_expected,
        total_items_received,
        scan_completion_pct,
        minutes_emission_to_delivery_note,
        minutes_batch_to_fully_scanned,
        snapshot_status,
        last_updated_at,
        created_at,
        updated_at
      )
      SELECT
        invoice_id,
        unit_business_id,
        transporter_id,
        type,
        invoice_date,
        emitted_at,
        delivery_note_generated_at,
        first_scan_at,
        last_scan_at,
        fully_processed_at,
        total_items_expected,
        total_items_received,
        scan_completion_pct,
        minutes_emission_to_delivery_note,
        minutes_batch_to_fully_scanned,
        snapshot_status,
        NOW(),
        NOW(),
        NOW()
      FROM snapshot_source
      ON CONFLICT (invoice_id) DO UPDATE SET
        unit_business_id = EXCLUDED.unit_business_id,
        transporter_id = EXCLUDED.transporter_id,
        type = EXCLUDED.type,
        invoice_date = EXCLUDED.invoice_date,
        emitted_at = EXCLUDED.emitted_at,
        delivery_note_generated_at = EXCLUDED.delivery_note_generated_at,
        first_scan_at = EXCLUDED.first_scan_at,
        last_scan_at = EXCLUDED.last_scan_at,
        fully_processed_at = EXCLUDED.fully_processed_at,
        total_items_expected = EXCLUDED.total_items_expected,
        total_items_received = EXCLUDED.total_items_received,
        scan_completion_pct = EXCLUDED.scan_completion_pct,
        minutes_emission_to_delivery_note = EXCLUDED.minutes_emission_to_delivery_note,
        minutes_batch_to_fully_scanned = EXCLUDED.minutes_batch_to_fully_scanned,
        snapshot_status = EXCLUDED.snapshot_status,
        last_updated_at = NOW(),
        updated_at = NOW()
      `,
      { replacements: { invoiceIds } },
    );
  }

  async findAffectedFactKeys(invoiceIds: string[]): Promise<AffectedFactKey[]> {
    if (!invoiceIds.length) return [];

    return sequelize.query<AffectedFactKey>(
      `
      SELECT DISTINCT invoice_date AS fact_date, unit_business_id
      FROM invoice_operation_snapshots
      WHERE invoice_id IN (:invoiceIds)
        AND invoice_date IS NOT NULL
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { invoiceIds },
      },
    );
  }

  async upsertDailyOperationFacts(keys: AffectedFactKey[]): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH snapshot_metrics AS (
          SELECT
            CAST(:factDate AS date) AS fact_date,
            CAST(:unitBusinessId AS uuid) AS unit_business_id,
            COUNT(*) FILTER (WHERE type = 'INCOMING')::integer AS invoices_incoming_count,
            COUNT(*) FILTER (WHERE type = 'OUTGOING')::integer AS invoices_outgoing_count,
            COUNT(*) FILTER (WHERE type = 'INCOMING')::integer AS invoices_incoming_total,
            COUNT(*) FILTER (WHERE type = 'OUTGOING')::integer AS invoices_outgoing_total,
            COUNT(*) FILTER (WHERE type = 'INCOMING' AND fully_processed_at IS NOT NULL)::integer AS invoices_incoming_fully_processed,
            COUNT(*) FILTER (WHERE type = 'OUTGOING' AND fully_processed_at IS NOT NULL)::integer AS invoices_outgoing_fully_processed,
            ROUND(AVG(minutes_emission_to_delivery_note) FILTER (WHERE type = 'OUTGOING' AND minutes_emission_to_delivery_note IS NOT NULL), 2) AS outgoing_perf_avg_minutes,
            MIN(minutes_emission_to_delivery_note) FILTER (WHERE type = 'OUTGOING' AND minutes_emission_to_delivery_note IS NOT NULL) AS outgoing_perf_min_minutes,
            MAX(minutes_emission_to_delivery_note) FILTER (WHERE type = 'OUTGOING' AND minutes_emission_to_delivery_note IS NOT NULL) AS outgoing_perf_max_minutes,
            COUNT(*) FILTER (WHERE type = 'OUTGOING' AND minutes_emission_to_delivery_note IS NOT NULL)::integer AS outgoing_perf_invoice_count,
            ROUND(AVG(minutes_batch_to_fully_scanned) FILTER (WHERE type = 'INCOMING' AND minutes_batch_to_fully_scanned IS NOT NULL), 2) AS incoming_perf_avg_minutes,
            MIN(minutes_batch_to_fully_scanned) FILTER (WHERE type = 'INCOMING' AND minutes_batch_to_fully_scanned IS NOT NULL) AS incoming_perf_min_minutes,
            MAX(minutes_batch_to_fully_scanned) FILTER (WHERE type = 'INCOMING' AND minutes_batch_to_fully_scanned IS NOT NULL) AS incoming_perf_max_minutes,
            COUNT(*) FILTER (WHERE type = 'INCOMING' AND minutes_batch_to_fully_scanned IS NOT NULL)::integer AS incoming_perf_invoice_count
          FROM invoice_operation_snapshots
          WHERE invoice_date = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
        ),
        volumes_received AS (
          SELECT COUNT(*)::integer AS total
          FROM entrance_scan_logs esl
          JOIN invoice_items ii ON ii.id = esl.invoice_items_id
          JOIN invoices i ON i.id = ii.invoice_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND i.unit_business_id = :unitBusinessId
        ),
        volumes_dispatched AS (
          SELECT COUNT(*)::integer AS total
          FROM expedition_scan_logs esl
          JOIN expedition_batches eb ON eb.id = esl.expedition_batch_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND eb.unit_business_id = :unitBusinessId
        )
        INSERT INTO daily_operation_facts (
          fact_date,
          unit_business_id,
          invoices_incoming_count,
          invoices_outgoing_count,
          volumes_received,
          volumes_dispatched,
          invoices_incoming_total,
          invoices_outgoing_total,
          invoices_incoming_fully_processed,
          invoices_outgoing_fully_processed,
          outgoing_perf_avg_minutes,
          outgoing_perf_min_minutes,
          outgoing_perf_max_minutes,
          outgoing_perf_invoice_count,
          incoming_perf_avg_minutes,
          incoming_perf_min_minutes,
          incoming_perf_max_minutes,
          incoming_perf_invoice_count,
          last_updated_at,
          created_at,
          updated_at
        )
        SELECT
          sm.fact_date,
          sm.unit_business_id,
          sm.invoices_incoming_count,
          sm.invoices_outgoing_count,
          vr.total,
          vd.total,
          sm.invoices_incoming_total,
          sm.invoices_outgoing_total,
          sm.invoices_incoming_fully_processed,
          sm.invoices_outgoing_fully_processed,
          sm.outgoing_perf_avg_minutes,
          sm.outgoing_perf_min_minutes,
          sm.outgoing_perf_max_minutes,
          sm.outgoing_perf_invoice_count,
          sm.incoming_perf_avg_minutes,
          sm.incoming_perf_min_minutes,
          sm.incoming_perf_max_minutes,
          sm.incoming_perf_invoice_count,
          NOW(),
          NOW(),
          NOW()
        FROM snapshot_metrics sm
        CROSS JOIN volumes_received vr
        CROSS JOIN volumes_dispatched vd
        ON CONFLICT (fact_date, unit_business_id) DO UPDATE SET
          invoices_incoming_count = EXCLUDED.invoices_incoming_count,
          invoices_outgoing_count = EXCLUDED.invoices_outgoing_count,
          volumes_received = EXCLUDED.volumes_received,
          volumes_dispatched = EXCLUDED.volumes_dispatched,
          invoices_incoming_total = EXCLUDED.invoices_incoming_total,
          invoices_outgoing_total = EXCLUDED.invoices_outgoing_total,
          invoices_incoming_fully_processed = EXCLUDED.invoices_incoming_fully_processed,
          invoices_outgoing_fully_processed = EXCLUDED.invoices_outgoing_fully_processed,
          outgoing_perf_avg_minutes = EXCLUDED.outgoing_perf_avg_minutes,
          outgoing_perf_min_minutes = EXCLUDED.outgoing_perf_min_minutes,
          outgoing_perf_max_minutes = EXCLUDED.outgoing_perf_max_minutes,
          outgoing_perf_invoice_count = EXCLUDED.outgoing_perf_invoice_count,
          incoming_perf_avg_minutes = EXCLUDED.incoming_perf_avg_minutes,
          incoming_perf_min_minutes = EXCLUDED.incoming_perf_min_minutes,
          incoming_perf_max_minutes = EXCLUDED.incoming_perf_max_minutes,
          incoming_perf_invoice_count = EXCLUDED.incoming_perf_invoice_count,
          last_updated_at = NOW(),
          updated_at = NOW()
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

  async findAffectedTransporterFactKeys(
    invoiceIds: string[],
  ): Promise<AffectedTransporterFactKey[]> {
    if (!invoiceIds.length) return [];

    return sequelize.query<AffectedTransporterFactKey>(
      `
      SELECT DISTINCT invoice_date AS fact_date, unit_business_id, transporter_id
      FROM invoice_operation_snapshots
      WHERE invoice_id IN (:invoiceIds)
        AND invoice_date IS NOT NULL
        AND transporter_id IS NOT NULL
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { invoiceIds },
      },
    );
  }

  async upsertDailyTransporterFacts(
    keys: AffectedTransporterFactKey[],
  ): Promise<void> {
    for (const key of keys) {
      await sequelize.query(
        `
        WITH volumes_dispatched AS (
          SELECT COUNT(*)::integer AS total
          FROM expedition_scan_logs esl
          JOIN expedition_batches eb ON eb.id = esl.expedition_batch_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND eb.unit_business_id = :unitBusinessId
            AND eb.transporters_id = :transporterId
        ),
        invoice_metrics AS (
          SELECT
            COUNT(*)::integer AS invoices_count,
            COUNT(*) FILTER (WHERE fully_processed_at IS NOT NULL)::integer AS invoices_fully_processed
          FROM invoice_operation_snapshots
          WHERE invoice_date = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND transporter_id = :transporterId
        )
        INSERT INTO daily_transporter_facts (
          fact_date,
          unit_business_id,
          transporter_id,
          volumes_dispatched,
          invoices_count,
          invoices_fully_processed,
          last_updated_at,
          created_at,
          updated_at
        )
        SELECT
          CAST(:factDate AS date),
          CAST(:unitBusinessId AS uuid),
          CAST(:transporterId AS uuid),
          vd.total,
          im.invoices_count,
          im.invoices_fully_processed,
          NOW(),
          NOW(),
          NOW()
        FROM volumes_dispatched vd
        CROSS JOIN invoice_metrics im
        ON CONFLICT (fact_date, unit_business_id, transporter_id) DO UPDATE SET
          volumes_dispatched = EXCLUDED.volumes_dispatched,
          invoices_count = EXCLUDED.invoices_count,
          invoices_fully_processed = EXCLUDED.invoices_fully_processed,
          last_updated_at = NOW(),
          updated_at = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            transporterId: key.transporter_id,
          },
        },
      );
    }
  }

  async getReport(filters: DailyOperationReportFilters) {
    const facts = await sequelize.query(
      `
      SELECT
        dof.*,
        ub.name AS unit_business_name,
        CASE
          WHEN dof.invoices_incoming_total = 0 THEN 0
          ELSE ROUND((dof.invoices_incoming_fully_processed::numeric / dof.invoices_incoming_total::numeric) * 100, 2)
        END AS pct_incoming,
        CASE
          WHEN dof.invoices_outgoing_total = 0 THEN 0
          ELSE ROUND((dof.invoices_outgoing_fully_processed::numeric / dof.invoices_outgoing_total::numeric) * 100, 2)
        END AS pct_outgoing
      FROM daily_operation_facts dof
      JOIN unit_businesses ub ON ub.id = dof.unit_business_id
      WHERE dof.fact_date = CAST(:date AS date)
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR dof.unit_business_id = CAST(:unitBusinessId AS uuid))
      ORDER BY ub.name ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          date: filters.date,
          unitBusinessId: filters.unitBusinessId ?? null,
        },
      },
    );

    const transporters = await sequelize.query(
      `
      SELECT dtf.*, t.name AS transporter_name
      FROM daily_transporter_facts dtf
      JOIN transporters t ON t.id = dtf.transporter_id
      WHERE dtf.fact_date = CAST(:date AS date)
        AND (CAST(:unitBusinessId AS uuid) IS NULL OR dtf.unit_business_id = CAST(:unitBusinessId AS uuid))
        AND (CAST(:transporterId AS uuid) IS NULL OR dtf.transporter_id = CAST(:transporterId AS uuid))
      ORDER BY t.name ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          date: filters.date,
          unitBusinessId: filters.unitBusinessId ?? null,
          transporterId: filters.transporterId ?? null,
        },
      },
    );

    const snapshots = filters.drillDown
      ? await sequelize.query(
          `
          SELECT *
          FROM invoice_operation_snapshots
          WHERE invoice_date = CAST(:date AS date)
            AND (CAST(:unitBusinessId AS uuid) IS NULL OR unit_business_id = CAST(:unitBusinessId AS uuid))
            AND (CAST(:transporterId AS uuid) IS NULL OR transporter_id = CAST(:transporterId AS uuid))
          ORDER BY minutes_emission_to_delivery_note DESC NULLS LAST, last_updated_at DESC
          `,
          {
            type: QueryTypes.SELECT,
            replacements: {
              date: filters.date,
              unitBusinessId: filters.unitBusinessId ?? null,
              transporterId: filters.transporterId ?? null,
            },
          },
        )
      : undefined;

    return {
      date: filters.date,
      facts,
      transporters,
      ...(snapshots ? { snapshots } : {}),
    };
  }
}

export const dailyOperationReportRepository =
  new DailyOperationReportRepository();
