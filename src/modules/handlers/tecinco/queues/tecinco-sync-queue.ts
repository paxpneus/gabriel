import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { TCarUpsertQueue } from "./tecinco-api-fetch.queue";
import { runMigration } from "../../../../scripts/tecinco/tecinco-migration.runner";
import { UnitBusiness } from "../../../../modules/warehouse";

export interface TCarSyncJobPayload {
  branchId: number;
  companyId: string;
  alteradoDesde: string;
}

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";

function formatAlteradoDesde(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export class TCarSyncQueue extends BaseQueueService<TCarSyncJobPayload> {
  private readonly upsertQueue: TCarUpsertQueue;

  constructor(options: { workless?: boolean } = {}) {
    super("TCAR_SYNC", {
      concurrency: 2,
      limiter: { max: 5, duration: 1000 },
      workless: options.workless,
    });
    this.upsertQueue = new TCarUpsertQueue({ workless: false });
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

export async function scheduleTCarSync() {
  const units = await UnitBusiness.findAll({ attributes: ["number"] });
  const branchIds: number[] = units.map((u) => Number(u.number));

  const syncQueue = new TCarSyncQueue();

  const dispatchSync = async () => {
    const alteradoDesde = formatAlteradoDesde(
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );

    for (const branchId of branchIds) {
      await syncQueue.add(
        { branchId, companyId: COMPANY_ID, alteradoDesde },
        `tcar-sync-${branchId}-${Date.now()}`,
      );

      console.log(
        `[TCAR_SYNC] Job agendado | branchId=${branchId} | alterado_desde=${alteradoDesde}`,
      );
    }
  };

  dispatchSync();
  setInterval(dispatchSync, 2 * 60 * 60 * 1000);
}