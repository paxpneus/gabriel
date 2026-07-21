import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import syncInvoiceOccurrencesService from './../services/sync-datafrete-invoice-occurrences.service';
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

export type LogisticOccurrencesSyncJobData = Record<string, never>;

export class LogisticOccurrencesSyncQueue extends BaseQueueService<LogisticOccurrencesSyncJobData> {
  constructor(options: { workless?: boolean } = {}) {
    super("LOGISTIC_OCCURRENCES_SYNC", {
      concurrency: 1,
      workless: options.workless,
    });
  }

  async process(job: Job<LogisticOccurrencesSyncJobData>): Promise<void> {
    console.log("[LogisticOccurrencesSync] Iniciando sincronização de ocorrências pendentes...");

    try {
      const result = await syncInvoiceOccurrencesService.syncPendingOccurrences();

      console.log(
        `[LogisticOccurrencesSync] Concluído. notas_processadas=${result.invoicesProcessed} ocorrencias_sincronizadas=${result.occurrencesSynced} falhas=${result.failed}`,
      );

      if (result.failed > 0) {
        alertService.sendAlert({
          severity: "MEDIUM",
          title: "Sincronização de Ocorrências Logísticas — falhas parciais",
          message: `${result.failed} nota(s) falharam ao sincronizar com a Datafrete, de um total de ${result.invoicesProcessed + result.failed} nota(s) elegível(is).`,
        });
      }
    } catch (error: any) {
      console.error("[LogisticOccurrencesSync] Falhou completamente:", error?.message ?? error);
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Sincronização de Ocorrências Logísticas falhou",
        message: `O job de sincronização de ocorrências logísticas falhou por completo: ${error?.message ?? error}`,
      });
      throw error;
    }
  }
}