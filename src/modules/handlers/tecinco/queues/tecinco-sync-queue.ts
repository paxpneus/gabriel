import { Job, Queue } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { TCarUpsertQueue } from "./tecinco-api-fetch.queue";
import {
  TCarInvoiceQueue,
  TCAR_INVOICE_NEW_JOB_NAME,
} from "./tecinco-invoice.queue";
import {
  migrateNovasNotasFiscais,
  runMigration,
} from "../../../../scripts/tecinco/tecinco-migration.runner";
import { UnitBusiness } from "../../../../modules/warehouse";
import { tecincoUnitBusinessForPopulate } from "../../../../shared/constants/tecinco-units";
import { tecincoTireGrupoIds } from "../../../../shared/constants/tecinco-groups";
import { Op } from "sequelize";

export interface TCarSyncJobPayload {
  branchId: number;
  companyId: string;
  alteradoDesde: string;
  kind: "invoices" | "full";
}

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const INVOICE_SYNC_INTERVAL_MS = 60 * 1000;
const FULL_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FULL_SYNC_REDELAY_MS = 15 * 1000;

function formatAlteradoDesde(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class TCarSyncQueue extends BaseQueueService<TCarSyncJobPayload> {
  constructor(
    private readonly apiFetchQueue: TCarUpsertQueue,
    private readonly invoiceQueue: TCarInvoiceQueue,
    options: { workless?: boolean } = {},
  ) {
    super("TCAR_SYNC", {
      concurrency: 2,
      limiter: { max: 2, duration: 1000 },
      workless: options.workless,
      maxProcessingMs: 15 * 60 * 60 * 1000,
    });
  }

  async process(job: Job<TCarSyncJobPayload>): Promise<void> {
    const { branchId, companyId, alteradoDesde, kind } = job.data;

    // full sync (produtos/clientes/notas) e o job de notas novas competem
    // pelo mesmo concurrency de TCAR_SYNC (2 slots pras 2 filiais); notas
    // novas são o fluxo urgente e não podem esperar atrás de um full sync
    // que já está no meio de uma migração longa. Em vez de segurar o slot
    // com um sleep/poll, redelay libera o slot pro job de "invoices"
    // pendente e este mesmo job full volta a ser tentado em breve.
    if (
      kind === "full" &&
      (await this.invoiceQueue.hasPendingJobsNamed([TCAR_INVOICE_NEW_JOB_NAME]))
    ) {
      console.log(
        `[TCAR_SYNC] Notas novas ainda pendentes — adiando full sync | branchId=${branchId}`,
      );
      return this.retryJobLater(job, FULL_SYNC_REDELAY_MS);
    }

    console.log(`[TCAR_SYNC] Iniciando ${kind} | branchId=${branchId}`);

    if (kind === "invoices") {
      await migrateNovasNotasFiscais({
        branchIds: [branchId],
        companyId,
        alteradoDesde,
        upsertQueue: this.apiFetchQueue,
        invoiceQueue: this.invoiceQueue,
      });
      return;
    }

    await runMigration({
      branchIds: [branchId],
      companyId,
      alteradoDesde,
      upsertQueue: this.apiFetchQueue,
      invoiceQueue: this.invoiceQueue,
      grupos: tecincoTireGrupoIds,
    });
    console.log(`[TCAR_SYNC] Sync completo concluído | branchId=${branchId}`);
  }

  async areTargetQueuesIdle(): Promise<boolean> {
    const [apiFetchPending, invoicePending] = await Promise.all([
      this.apiFetchQueue.hasPendingJobs(),
      this.invoiceQueue.hasPendingJobs(),
    ]);
    return !apiFetchPending && !invoicePending;
  }

  protected override onFailed(job: Job<TCarSyncJobPayload>, error: Error): void {
    alertService.sendAlert({
      severity: "MEDIUM",
      title: "TCarSyncQueue — job falhou",
      message: `kind=${job.data.kind} | branchId=${job.data.branchId} | Erro: ${error.message}`,
    });
  }
}

export async function scheduleTCarSync(syncQueue: TCarSyncQueue) {
  const units = await UnitBusiness.findAll({
    attributes: ["number"],
    where: { number: { [Op.in]: tecincoUnitBusinessForPopulate } },
  });
  const branchIds = units.map((unit) => Number(unit.number));
  const syncBullQueue: Queue = (syncQueue as any).queue;

  const dispatch = async (kind: TCarSyncJobPayload["kind"], intervalMs: number) => {
    const jobs = await syncBullQueue.getJobs([
      "active",
      "waiting",
      "delayed",
      "prioritized",
    ]);
    const sameKindPending = jobs.some((job) => job.data.kind === kind);
    const targetsAreIdle =
      kind === "invoices" || (await syncQueue.areTargetQueuesIdle());

    const shouldDispatch = !sameKindPending && targetsAreIdle;

    if (shouldDispatch) {
      const alteradoDesde = formatAlteradoDesde(
        new Date(Date.now() - 2 * 60 * 60 * 1000),
      );
      await Promise.all(
        branchIds.map((branchId) =>
          syncQueue.add(
            { branchId, companyId: COMPANY_ID, alteradoDesde, kind },
            kind === "invoices"
              ? `tcar-sync-${kind}-${branchId}-${Date.now()}`
              : `tcar-sync-${kind}-${branchId}`,
          ),
        ),
      );
    } else if (kind === "full" && !targetsAreIdle) {
      console.log(
        "[TCAR_SYNC] TCAR_INVOICE ou TCAR_API_FETCH ainda possui jobs; pulando sync completo",
      );
    } else {
      console.log(`[TCAR_SYNC] Já há job(s) ${kind} em andamento; pulando dispatch`);
    }

    setTimeout(() => void dispatch(kind, intervalMs), intervalMs);
  };

  void dispatch("invoices", INVOICE_SYNC_INTERVAL_MS);
  void dispatch("full", FULL_SYNC_INTERVAL_MS);
}
