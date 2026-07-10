import { Job, Queue } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { TCarUpsertQueue } from "./tecinco-api-fetch.queue";
import { runMigration } from "../../../../scripts/tecinco/tecinco-migration.runner";
import { UnitBusiness } from "../../../../modules/warehouse";
import { tecincoUnitBusinessForPopulate } from "../../../../shared/constants/tecinco-units";
import { Op } from "sequelize";

export interface TCarSyncJobPayload {
  branchId: number;
  companyId: string;
  alteradoDesde: string;
}

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const SYNC_RETRY_MS = 20 * 60 * 1000;


function formatAlteradoDesde(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export class TCarSyncQueue extends BaseQueueService<TCarSyncJobPayload> {
  private readonly upsertQueue: TCarUpsertQueue;

  constructor(
    upsertQueue: TCarUpsertQueue,
    options: { workless?: boolean } = {},
  ) {
    super("TCAR_SYNC", {
      concurrency: 2,
      limiter: { max: 5, duration: 1000 },
      workless: options.workless,
    });
    this.upsertQueue = upsertQueue; 
  }

  async process(job: Job<TCarSyncJobPayload>): Promise<void> {
    const { branchId, companyId, alteradoDesde } = job.data;

    console.log(
      `[TCAR_SYNC] Iniciando sync | branchId=${branchId} | alterado_desde=${alteradoDesde}`,
    );

    await runMigration({
      branchIds: [branchId],
      companyId,
      alteradoDesde,
      upsertQueue: this.upsertQueue,
    });

    console.log(`[TCAR_SYNC] Sync concluído | branchId=${branchId}`);
  }

  protected override onFailed(job: Job<TCarSyncJobPayload>, error: Error): void {
    alertService.sendAlert({
      severity: "MEDIUM",
      title: "TCarSyncQueue — job falhou",
      message: `branchId=${job.data.branchId} | alterado_desde=${job.data.alteradoDesde} | Erro: ${error.message}`,
    });
  }
}

export async function scheduleTCarSync(syncQueue: TCarSyncQueue) {
  const units = await UnitBusiness.findAll({
    attributes: ["id", "id_system", "number"],
    where: {
      number: {
        [Op.in]: tecincoUnitBusinessForPopulate,
      },
    },
  });
  const branchIds: number[] = units.map((u) => Number(u.number));

  const bullQueue: Queue = (syncQueue as any).queue;

  const dispatchSync = async () => {
    const counts = await bullQueue.getJobCounts("active", "waiting", "delayed");
    const pending = (counts.active ?? 0) + (counts.waiting ?? 0) + (counts.delayed ?? 0);

    if (pending > 0) {
      console.log(
        `[TCAR_SYNC] Fila ainda com ${pending} job(s) pendente(s) — pulando dispatch, tentando de novo em 20min`,
      );
      setTimeout(dispatchSync, SYNC_RETRY_MS);
      return;
    }

    const alteradoDesde = formatAlteradoDesde(new Date(Date.now() - 2 * 60 * 60 * 1000));
    for (const branchId of branchIds) {
      await syncQueue.add(
        { branchId, companyId: COMPANY_ID, alteradoDesde },
        `tcar-sync-${branchId}`,
      );
      console.log(`[TCAR_SYNC] Job agendado | branchId=${branchId}`);
    }

    setTimeout(dispatchSync, SYNC_INTERVAL_MS);
  };

  dispatchSync();
}