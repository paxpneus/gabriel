import { Job, Queue } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { TCarUpsertQueue } from "./tecinco-api-fetch.queue";
import {
  TCarInvoiceQueue,
  TCAR_INVOICE_UPDATE_JOB_NAME,
} from "./tecinco-invoice.queue";
import {
  enqueueInvoiceUpdates,
  migrateNovasNotasFiscais,
  runProductsMigration,
} from "../../../../scripts/tecinco/tecinco-migration.runner";
import { UnitBusiness } from "../../../../modules/warehouse";
import { tecincoUnitBusinessForPopulate } from "../../../../shared/constants/tecinco-units";
import { tecincoTireGrupoIds } from "../../../../shared/constants/tecinco-groups";
import { Op } from "sequelize";

export interface TCarSyncJobPayload {
  branchIds: number[];
  companyId: string;
  alteradoDesde: string;
  kind: "invoices" | "products" | "invoice-updates";
}

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const INVOICE_SYNC_INTERVAL_MS = 60 * 1000;
const SLOW_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
    const { branchIds, companyId, alteradoDesde, kind } = job.data;

    console.log(`[TCAR_SYNC] Iniciando ${kind} | branchIds=${branchIds.join(",")}`);

    const migrationOptions = {
      branchIds,
      companyId,
      alteradoDesde,
      upsertQueue: this.apiFetchQueue,
      invoiceQueue: this.invoiceQueue,
    };

    if (kind === "invoices") {
      await migrateNovasNotasFiscais(migrationOptions);
      return;
    }

    if (kind === "invoice-updates") {
      await enqueueInvoiceUpdates(migrationOptions);
      return;
    }

    await runProductsMigration({ ...migrationOptions, grupos: tecincoTireGrupoIds });
    console.log(`[TCAR_SYNC] Sync de produtos concluído | branchIds=${branchIds.join(",")}`);
  }

  // Products só roda com TCAR_API_FETCH vazia; updates de nota só se não há
  // update pendente (rodam em prioridade menor que invoice-new).
  async shouldDispatch(kind: TCarSyncJobPayload["kind"]): Promise<boolean> {
    if (kind === "invoices") return true;
    if (kind === "products") return !(await this.apiFetchQueue.hasPendingJobs());
    return !(await this.invoiceQueue.hasPendingJobsNamed([
      TCAR_INVOICE_UPDATE_JOB_NAME,
    ]));
  }

  protected override onFailed(job: Job<TCarSyncJobPayload>, error: Error): void {
    alertService.sendAlert({
      severity: "MEDIUM",
      title: "TCarSyncQueue — job falhou",
      message: `kind=${job.data.kind} | branchIds=${job.data.branchIds.join(",")} | Erro: ${error.message}`,
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
    const canDispatch = await syncQueue.shouldDispatch(kind);

    if (!sameKindPending && canDispatch) {
      const alteradoDesde = formatAlteradoDesde(
        new Date(Date.now() - 2 * 60 * 60 * 1000),
      );
      // products roda uma vez pra todas as filiais (produtos vêm numa busca só)
      const payloads =
        kind === "products"
          ? [{ branchIds, jobId: `tcar-sync-${kind}` }]
          : branchIds.map((branchId) => ({
              branchIds: [branchId],
              jobId:
                kind === "invoices"
                  ? `tcar-sync-${kind}-${branchId}-${Date.now()}`
                  : `tcar-sync-${kind}-${branchId}`,
            }));
      await Promise.all(
        payloads.map(({ branchIds: ids, jobId }) =>
          syncQueue.add(
            { branchIds: ids, companyId: COMPANY_ID, alteradoDesde, kind },
            jobId,
          ),
        ),
      );
    } else {
      console.log(`[TCAR_SYNC] Pulando dispatch ${kind} (job em andamento ou fila alvo ocupada)`);
    }

    setTimeout(() => void dispatch(kind, intervalMs), intervalMs);
  };

  void dispatch("invoices", INVOICE_SYNC_INTERVAL_MS);
  void dispatch("products", SLOW_SYNC_INTERVAL_MS);
  void dispatch("invoice-updates", SLOW_SYNC_INTERVAL_MS);
}
