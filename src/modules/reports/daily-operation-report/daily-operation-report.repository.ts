import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  AffectedFactKey,
  AffectedTransporterFactKey,
  DailyOperationReportFilters,
} from "./daily-operation-report.types";

const JOB_NAME = "daily_operation_report";

/**
 * Transportadoras internas (CD 12 e CD 17) excluídas do fluxo analítico principal.
 * Notas vinculadas a essas transportadoras são marcadas como `is_advance_payment = TRUE`
 * e aparecem no relatório como contagem separada, sem influenciar KPIs.
 * id_system: '18130521578' (CD 12) e '18130513305' (CD 17)
 */
const EXCLUDED_TRANSPORTER_ID_SYSTEMS = ["18130521578", "18130513305"];

interface CheckpointRow {
  last_processed_at: Date;
}

interface InvoiceIdRow {
  invoice_id: string;
}

export class DailyOperationReportRepository {
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
        "Não foi possível inicializar o checkpoint daily_operation_report.",
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
          ebi.invoice_id,
          MIN(esl.created_at) AS first_scan_at,
          MAX(esl.created_at) AS last_scan_at
        FROM expedition_scan_logs esl
        JOIN expedition_batch_invoices ebi ON ebi.id = esl.expedition_batch_invoices_id
        JOIN affected a ON a.invoice_id = ebi.invoice_id
        GROUP BY ebi.invoice_id
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
      -- Identifica se a invoice é devolução de fornecedor:
      -- INCOMING onde sender_cnpj bate com algum CNPJ de unit_business cadastrado no sistema.
      supplier_returns AS (
        SELECT
          i.id AS invoice_id,
          TRUE AS is_supplier_return
        FROM invoices i
        JOIN affected a ON a.invoice_id = i.id
        JOIN unit_businesses ub ON ub.cnpj = i.sender_cnpj
        WHERE i.type = 'INCOMING'
      ),
      -- Identifica notas de adiantamento:
      -- Notas cuja transportadora efetiva (batch tem precedência sobre a nota)
      -- pertence às transportadoras internas (CD 12 ou CD 17).
      -- Essas notas são gravadas no snapshot mas ficam fora dos KPIs principais.
      advance_payments AS (
        SELECT
          i.id AS invoice_id,
          TRUE AS is_advance_payment
        FROM invoices i
        JOIN affected a ON a.invoice_id = i.id
        LEFT JOIN batch_data bd ON bd.invoice_id = i.id
        LEFT JOIN transporters t_eff ON t_eff.id = CASE
          WHEN bd.invoice_id IS NOT NULL THEN bd.batch_transporter_id
          ELSE i.transporter_id
        END
        WHERE t_eff.id_system = ANY(ARRAY[:excludedTransporterIdSystems])
      ),
      snapshot_source AS (
        SELECT
          i.id AS invoice_id,
          i.unit_business_id,
          -- Transporter efetivo: batch tem precedência sobre a nota
          CASE
            WHEN bd.invoice_id IS NOT NULL THEN bd.batch_transporter_id
            ELSE i.transporter_id
          END AS transporter_id,
          i.type,
          DATE(COALESCE(i.emitted_at, i.created_at)) AS invoice_date,
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
              AND COALESCE(it.total_received, 0) >= COALESCE(it.total_expected, 0)
              THEN sb.last_scan_at
            WHEN i.type = 'OUTGOING' AND bd.delivery_note_generated_at IS NOT NULL
              THEN bd.delivery_note_generated_at
            ELSE NULL
          END AS fully_processed_at,
          CASE
            WHEN i.type = 'OUTGOING'
              AND i.emitted_at IS NOT NULL
              AND bd.delivery_note_generated_at IS NOT NULL
              -- Convertido de minutos para horas decimais (/ 60)
              THEN ROUND((EXTRACT(EPOCH FROM (bd.delivery_note_generated_at - i.emitted_at::timestamptz)) / 3600)::numeric, 2)
            ELSE NULL
          END AS hours_emission_to_delivery_note,
          CASE
            WHEN i.type = 'INCOMING'
              AND COALESCE(it.total_expected, 0) > 0
              AND COALESCE(it.total_received, 0) >= COALESCE(it.total_expected, 0)
              AND sb.last_scan_at IS NOT NULL
              -- Convertido de minutos para horas decimais (/ 60)
              THEN ROUND((EXTRACT(EPOCH FROM (sb.last_scan_at - COALESCE(i.received_at, i.emitted_at)::timestamptz)) / 3600)::numeric, 2)
            ELSE NULL
          END AS hours_batch_to_fully_scanned,
          CASE
            WHEN i.status = 'CANCELLED'                THEN 'cancelled'
            WHEN i.status = 'PENDING_CANCELLED_SYSTEM' THEN 'pending_cancelled'
            WHEN i.status = 'FINISHED'                 THEN 'completed'
            ELSE 'open'
          END AS snapshot_status,
          -- Flag de devolução de fornecedor: INCOMING cujo sender_cnpj é de uma filial
          COALESCE(sr.is_supplier_return, FALSE) AS is_supplier_return,
          -- Flag de adiantamento: nota cuja transportadora efetiva é interna (CD 12 / CD 17)
          COALESCE(ap.is_advance_payment, FALSE) AS is_advance_payment
        FROM invoices i
        JOIN affected a ON a.invoice_id = i.id
        LEFT JOIN item_totals it      ON it.invoice_id = i.id
        LEFT JOIN scan_bounds sb      ON sb.invoice_id = i.id
        LEFT JOIN batch_data bd       ON bd.invoice_id = i.id
        LEFT JOIN supplier_returns sr ON sr.invoice_id = i.id
        LEFT JOIN advance_payments ap ON ap.invoice_id = i.id
        -- Sem filtro de exclusão aqui: adiantamentos são gravados com flag, não descartados
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
        hours_emission_to_delivery_note,
        hours_batch_to_fully_scanned,
        snapshot_status,
        is_supplier_return,
        is_advance_payment,
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
        hours_emission_to_delivery_note,
        hours_batch_to_fully_scanned,
        snapshot_status,
        is_supplier_return,
        is_advance_payment,
        NOW(),
        NOW(),
        NOW()
      FROM snapshot_source
      ON CONFLICT (invoice_id) DO UPDATE SET
        unit_business_id                 = EXCLUDED.unit_business_id,
        transporter_id                   = EXCLUDED.transporter_id,
        type                             = EXCLUDED.type,
        invoice_date                     = EXCLUDED.invoice_date,
        emitted_at                       = EXCLUDED.emitted_at,
        delivery_note_generated_at       = EXCLUDED.delivery_note_generated_at,
        first_scan_at                    = EXCLUDED.first_scan_at,
        last_scan_at                     = EXCLUDED.last_scan_at,
        fully_processed_at               = EXCLUDED.fully_processed_at,
        total_items_expected             = EXCLUDED.total_items_expected,
        total_items_received             = EXCLUDED.total_items_received,
        scan_completion_pct              = EXCLUDED.scan_completion_pct,
        hours_emission_to_delivery_note  = EXCLUDED.hours_emission_to_delivery_note,
        hours_batch_to_fully_scanned     = EXCLUDED.hours_batch_to_fully_scanned,
        snapshot_status                  = EXCLUDED.snapshot_status,
        is_supplier_return               = EXCLUDED.is_supplier_return,
        is_advance_payment               = EXCLUDED.is_advance_payment,
        last_updated_at                  = NOW(),
        updated_at                       = NOW()
      `,
      {
        replacements: {
          invoiceIds,
          excludedTransporterIdSystems: EXCLUDED_TRANSPORTER_ID_SYSTEMS,
        },
      },
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

            -- Contar apenas notas que NÃO são devolução de fornecedor e NÃO são adiantamento.
            -- Canceladas ficam fora do fluxo normal e são contadas separadamente abaixo.
            COUNT(*) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
            )::integer AS invoices_incoming_count,

            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
            )::integer AS invoices_outgoing_count,

            COUNT(*) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
            )::integer AS invoices_incoming_total,

            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
            )::integer AS invoices_outgoing_total,

            -- Completude: excluir devoluções de fornecedor, adiantamentos e canceladas das entradas
            COUNT(*) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
                AND fully_processed_at IS NOT NULL
            )::integer AS invoices_incoming_fully_processed,

            -- Completude de saída: canceladas fora pelo filtro de status
            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
                AND fully_processed_at IS NOT NULL
            )::integer AS invoices_outgoing_fully_processed,

            -- Devoluções de fornecedor: contagem separada, sem entrar no fluxo
            COUNT(*) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = TRUE
            )::integer AS supplier_return_count,

            -- Adiantamentos: contagem separada, sem entrar no fluxo
            COUNT(*) FILTER (
              WHERE is_advance_payment = TRUE
            )::integer AS advance_payment_count,

            -- Canceladas definitivamente (status CANCELLED → snapshot_status 'cancelled').
            -- Ficam fora dos KPIs operacionais mas entram no indicador de cancelamento.
            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status = 'cancelled'
            )::integer AS invoices_outgoing_cancelled,

            -- Cancelamento pendente no sistema (status PENDING_CANCELLED_SYSTEM → snapshot_status 'pending_cancelled').
            -- Mesma lógica: fora dos KPIs operacionais, dentro do indicador de cancelamento.
            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status = 'pending_cancelled'
            )::integer AS invoices_outgoing_pending_cancelled,

            -- Desempenho de saída em HORAS decimais — canceladas e adiantamentos excluídos
            ROUND(AVG(hours_emission_to_delivery_note) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
                AND hours_emission_to_delivery_note IS NOT NULL
            ), 2) AS outgoing_perf_avg_hours,

            MIN(hours_emission_to_delivery_note) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
                AND hours_emission_to_delivery_note IS NOT NULL
            ) AS outgoing_perf_min_hours,

            MAX(hours_emission_to_delivery_note) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
                AND hours_emission_to_delivery_note IS NOT NULL
            ) AS outgoing_perf_max_hours,

            COUNT(*) FILTER (
              WHERE type = 'OUTGOING'
                AND is_advance_payment = FALSE
                AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
                AND hours_emission_to_delivery_note IS NOT NULL
            )::integer AS outgoing_perf_invoice_count,

            -- Desempenho de entrada em HORAS decimais — devoluções e adiantamentos excluídos
            ROUND(AVG(hours_batch_to_fully_scanned) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
                AND hours_batch_to_fully_scanned IS NOT NULL
            ), 2) AS incoming_perf_avg_hours,

            MIN(hours_batch_to_fully_scanned) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
                AND hours_batch_to_fully_scanned IS NOT NULL
            ) AS incoming_perf_min_hours,

            MAX(hours_batch_to_fully_scanned) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
                AND hours_batch_to_fully_scanned IS NOT NULL
            ) AS incoming_perf_max_hours,

            COUNT(*) FILTER (
              WHERE type = 'INCOMING'
                AND is_supplier_return = FALSE
                AND is_advance_payment = FALSE
                AND hours_batch_to_fully_scanned IS NOT NULL
            )::integer AS incoming_perf_invoice_count

          FROM invoice_operation_snapshots
          WHERE invoice_date = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
        ),
        volumes_received AS (
          SELECT COUNT(*)::integer AS total
          FROM expedition_scan_logs esl
          JOIN expedition_batches eb ON eb.id = esl.expedition_batch_id
          -- Excluir transportadoras internas nos volumes recebidos
          LEFT JOIN transporters t ON t.id = eb.transporters_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND eb.unit_business_id = :unitBusinessId
            AND eb.type = 'INCOMING'
            AND (t.id_system IS NULL OR t.id_system NOT IN (:excludedTransporterIdSystems))
        ),
        volumes_dispatched AS (
          SELECT COUNT(*)::integer AS total
          FROM expedition_scan_logs esl
          JOIN expedition_batches eb ON eb.id = esl.expedition_batch_id
          -- Excluir transportadoras internas nos volumes expedidos
          LEFT JOIN transporters t ON t.id = eb.transporters_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND eb.unit_business_id = :unitBusinessId
            AND eb.type = 'OUTGOING'
            AND (t.id_system IS NULL OR t.id_system NOT IN (:excludedTransporterIdSystems))
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
          supplier_return_count,
          advance_payment_count,
          invoices_outgoing_cancelled,
          invoices_outgoing_pending_cancelled,
          outgoing_perf_avg_hours,
          outgoing_perf_min_hours,
          outgoing_perf_max_hours,
          outgoing_perf_invoice_count,
          incoming_perf_avg_hours,
          incoming_perf_min_hours,
          incoming_perf_max_hours,
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
          sm.supplier_return_count,
          sm.advance_payment_count,
          sm.invoices_outgoing_cancelled,
          sm.invoices_outgoing_pending_cancelled,
          sm.outgoing_perf_avg_hours,
          sm.outgoing_perf_min_hours,
          sm.outgoing_perf_max_hours,
          sm.outgoing_perf_invoice_count,
          sm.incoming_perf_avg_hours,
          sm.incoming_perf_min_hours,
          sm.incoming_perf_max_hours,
          sm.incoming_perf_invoice_count,
          NOW(),
          NOW(),
          NOW()
        FROM snapshot_metrics sm
        CROSS JOIN volumes_received vr
        CROSS JOIN volumes_dispatched vd
        ON CONFLICT (fact_date, unit_business_id) DO UPDATE SET
          invoices_incoming_count              = EXCLUDED.invoices_incoming_count,
          invoices_outgoing_count              = EXCLUDED.invoices_outgoing_count,
          volumes_received                     = EXCLUDED.volumes_received,
          volumes_dispatched                   = EXCLUDED.volumes_dispatched,
          invoices_incoming_total              = EXCLUDED.invoices_incoming_total,
          invoices_outgoing_total              = EXCLUDED.invoices_outgoing_total,
          invoices_incoming_fully_processed    = EXCLUDED.invoices_incoming_fully_processed,
          invoices_outgoing_fully_processed    = EXCLUDED.invoices_outgoing_fully_processed,
          supplier_return_count                = EXCLUDED.supplier_return_count,
          advance_payment_count                = EXCLUDED.advance_payment_count,
          invoices_outgoing_cancelled          = EXCLUDED.invoices_outgoing_cancelled,
          invoices_outgoing_pending_cancelled  = EXCLUDED.invoices_outgoing_pending_cancelled,
          outgoing_perf_avg_hours              = EXCLUDED.outgoing_perf_avg_hours,
          outgoing_perf_min_hours              = EXCLUDED.outgoing_perf_min_hours,
          outgoing_perf_max_hours              = EXCLUDED.outgoing_perf_max_hours,
          outgoing_perf_invoice_count          = EXCLUDED.outgoing_perf_invoice_count,
          incoming_perf_avg_hours              = EXCLUDED.incoming_perf_avg_hours,
          incoming_perf_min_hours              = EXCLUDED.incoming_perf_min_hours,
          incoming_perf_max_hours              = EXCLUDED.incoming_perf_max_hours,
          incoming_perf_invoice_count          = EXCLUDED.incoming_perf_invoice_count,
          last_updated_at                      = NOW(),
          updated_at                           = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            excludedTransporterIdSystems: EXCLUDED_TRANSPORTER_ID_SYSTEMS,
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
      SELECT DISTINCT ios.invoice_date AS fact_date, ios.unit_business_id, ios.transporter_id
      FROM invoice_operation_snapshots ios
      -- Excluir transportadoras internas dos facts de transportadora
      JOIN transporters t ON t.id = ios.transporter_id
      WHERE ios.invoice_id IN (:invoiceIds)
        AND ios.invoice_date IS NOT NULL
        AND ios.transporter_id IS NOT NULL
        AND ios.type = 'OUTGOING'
        AND ios.is_advance_payment = FALSE
        AND t.id_system NOT IN (:excludedTransporterIdSystems)
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          invoiceIds,
          excludedTransporterIdSystems: EXCLUDED_TRANSPORTER_ID_SYSTEMS,
        },
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
          -- Garantia dupla: excluir transportadoras internas
          LEFT JOIN transporters t ON t.id = eb.transporters_id
          WHERE DATE(esl.created_at) = CAST(:factDate AS date)
            AND eb.unit_business_id = :unitBusinessId
            AND eb.transporters_id = :transporterId
            AND eb.type = 'OUTGOING'
            AND (t.id_system IS NULL OR t.id_system NOT IN (:excludedTransporterIdSystems))
        ),
        invoice_metrics AS (
          SELECT
            COUNT(*)::integer AS invoices_count,
            COUNT(*) FILTER (WHERE fully_processed_at IS NOT NULL)::integer AS invoices_fully_processed
          FROM invoice_operation_snapshots
          WHERE invoice_date = CAST(:factDate AS date)
            AND unit_business_id = :unitBusinessId
            AND transporter_id = :transporterId
            AND type = 'OUTGOING'
            AND is_supplier_return = FALSE
            AND is_advance_payment = FALSE
            -- Canceladas fora do cômputo de transportadora também
            AND snapshot_status NOT IN ('cancelled', 'pending_cancelled')
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
          volumes_dispatched       = EXCLUDED.volumes_dispatched,
          invoices_count           = EXCLUDED.invoices_count,
          invoices_fully_processed = EXCLUDED.invoices_fully_processed,
          last_updated_at          = NOW(),
          updated_at               = NOW()
        `,
        {
          replacements: {
            factDate: key.fact_date,
            unitBusinessId: key.unit_business_id,
            transporterId: key.transporter_id,
            excludedTransporterIdSystems: EXCLUDED_TRANSPORTER_ID_SYSTEMS,
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
        END AS pct_outgoing,

        -- Total de notas emitidas no dia: fluxo normal + canceladas + pendentes de cancelamento.
        -- Usado como denominador do KPI de cancelamento para refletir tudo que foi tentado vender.
        (
          dof.invoices_outgoing_total
          + dof.invoices_outgoing_cancelled
          + dof.invoices_outgoing_pending_cancelled
        ) AS invoices_outgoing_emitted_total,

        -- KPI de cancelamento: de tudo que foi emitido no dia, qual % virou cancelamento.
        -- Numerador: canceladas + pendentes de cancelamento.
        -- Denominador: fluxo normal + canceladas + pendentes (universo completo do dia).
        CASE
          WHEN (
            dof.invoices_outgoing_total
            + dof.invoices_outgoing_cancelled
            + dof.invoices_outgoing_pending_cancelled
          ) = 0 THEN 0
          ELSE ROUND(
            (
              (dof.invoices_outgoing_cancelled + dof.invoices_outgoing_pending_cancelled)::numeric
              / (
                  dof.invoices_outgoing_total
                  + dof.invoices_outgoing_cancelled
                  + dof.invoices_outgoing_pending_cancelled
                )::numeric
            ) * 100,
            2
          )
        END AS pct_outgoing_cancelled

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
      -- Excluir transportadoras internas da listagem do relatório
      WHERE dtf.fact_date = CAST(:date AS date)
        AND t.id_system NOT IN (:excludedTransporterIdSystems)
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
          excludedTransporterIdSystems: EXCLUDED_TRANSPORTER_ID_SYSTEMS,
        },
      },
    );

    const snapshots = filters.drillDown
      ? await sequelize.query(
          `
          SELECT ios.*, i.number_system, i.description
          FROM invoice_operation_snapshots ios
          JOIN invoices i ON i.id = ios.invoice_id
          -- Adiantamentos aparecem no drill-down (is_advance_payment visível ao consumidor)
          LEFT JOIN transporters t ON t.id = ios.transporter_id
          WHERE ios.invoice_date = CAST(:date AS date)
            AND (CAST(:unitBusinessId AS uuid) IS NULL OR ios.unit_business_id = CAST(:unitBusinessId AS uuid))
            AND (CAST(:transporterId AS uuid) IS NULL OR ios.transporter_id = CAST(:transporterId AS uuid))
          ORDER BY ios.hours_emission_to_delivery_note DESC NULLS LAST, ios.last_updated_at DESC
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