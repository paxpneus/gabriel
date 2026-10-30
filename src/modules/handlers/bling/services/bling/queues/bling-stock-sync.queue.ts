import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { syncStockFromBling } from "../../../../../../scripts/bling/sync-stock-from-bling";
import { BlingMigrationQueue } from "./bling-daily-recover";

// Scheduler fixo (id estável): restart do worker atualiza o agendamento em vez de duplicar.
export const BLING_STOCK_SYNC_SCHEDULER_ID = "bling-stock-sync";
export const BLING_STOCK_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Alinha `stocks` com o saldo físico da Bling (script sync-stock-from-bling); sem sharedLock: roda sem esperar as outras filas Bling.
export class BlingStockSyncQueue extends BaseQueueService<void> {
  // Client workless da BLING_MIGRATION: só pra saber se a migração está rodando (trava abaixo).
  private migrationQueue: BlingMigrationQueue;

  constructor(options: { workless?: boolean } = {}) {
    super("BLING_STOCK_SYNC", {
      concurrency: 1,
      // Só divide o rate limit da Bling (Redis) com os workers; com fila cheia pode passar dos 5min default.
      lockDuration: 10 * 60 * 1000,
      maxProcessingMs: 9 * 60 * 1000,
      workless: options.workless,
    });
    this.migrationQueue = new BlingMigrationQueue({ workless: true });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    // Trava: migração regrava produto/estoque da Bling — pula a rodada; a próxima (5min) já é a nova tentativa.
    if ((await this.migrationQueue.queue.getActiveCount()) > 0) {
      console.log(`[BlingStockSyncQueue] BLING_MIGRATION rodando — sync de estoque pulado. jobId=${job.id}`);
      return;
    }

    console.log(`[BlingStockSyncQueue] Sincronizando estoque com a Bling... jobId=${job.id}`);

    const { divergent, failedBatches } = await syncStockFromBling(false);

    // Lote falho marca o job como falho (visível no bull-board); a próxima rodada já é o retry.
    if (failedBatches > 0) {
      throw new Error(
        `[BlingStockSyncQueue] ${failedBatches} lote(s) de /estoques/saldos falharam (divergentes gravados: ${divergent})`,
      );
    }
  }
}
