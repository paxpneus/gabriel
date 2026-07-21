import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import  invoiceLogisticOccurrencesIngestionService  from "../services/fetch-invoice-occurrences.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

export type LogisticOccurrencesIngestionJobData = Record<string, never>;

export class LogisticOccurrencesIngestionQueue extends BaseQueueService<LogisticOccurrencesIngestionJobData> {
  constructor(options: { workless?: boolean } = {}) {
    super("LOGISTIC_OCCURRENCES_INGESTION", {
      concurrency: 1,
      workless: options.workless,
    });
  }

  async process(job: Job<LogisticOccurrencesIngestionJobData>): Promise<void> {
    console.log("[LogisticOccurrencesIngestion] Iniciando ingestão de ocorrências...");

    try {
      const result = await invoiceLogisticOccurrencesIngestionService.ingestPendingOccurrences();

      console.log(
        `[LogisticOccurrencesIngestion] Concluído. processadas=${result.processed} notas_com_novidade=${result.invoicesWithNewOccurrences} ocorrencias_criadas=${result.occurrencesCreated} falhas=${result.failed}`,
      );

      if (result.failed > 0) {
        alertService.sendAlert({
          severity: "MEDIUM",
          title: "Ingestão de Ocorrências Logísticas — falhas parciais",
          message: `${result.failed} nota(s) falharam ao consultar a API da transportadora, de um total de ${result.processed} processada(s).`,
        });
      }
    } catch (error: any) {
      console.error("[LogisticOccurrencesIngestion] Falhou completamente:", error?.message ?? error);
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Ingestão de Ocorrências Logísticas falhou",
        message: `O job de ingestão de ocorrências logísticas falhou por completo: ${error?.message ?? error}`,
      });
      throw error;
    }
  }
}