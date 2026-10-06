import { Job, UnrecoverableError } from "bullmq";
import {
  TCAR_INVOICE_XML_UNAVAILABLE,
  TCarUpsertJobPayload,
  TCarUpsertQueue,
} from "./tecinco-api-fetch.queue";
import {
  TCarInvoiceTransferPayload,
  TCarInvoiceXmlPayload,
} from "../service/tecinco/tecinco.types";

// Nomes de job usados tanto ao enfileirar (tecinco-migration.runner.ts)
// quanto ao checar prioridade aqui — nunca hardcoded nos dois lugares.
export const TCAR_INVOICE_NEW_JOB_NAME = "invoice-new";
export const TCAR_INVOICE_UPDATE_JOB_NAME = "invoice-update";

export const TCAR_INVOICE_XML_RETRY_DELAY_MS = 5 * 60 * 1000;
export const TCAR_INVOICE_XML_MAX_ATTEMPTS = 5;
// Prefixo do failedReason — o sync usa pra não reenfileirar essas notas (ver migrateNovasNotasFiscais).
export const TCAR_INVOICE_XML_UNAVAILABLE_FAILURE = "XML indisponível na Tecinco";

/** Processa XMLs de nota em uma fila independente de produtos e clientes. */
export class TCarInvoiceQueue extends TCarUpsertQueue {
  constructor(options: { workless?: boolean } = {}) {
    super(options, "TCAR_INVOICE", 2);
  }

  override async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, data, branchId } = job.data;

    console.log(`[TCAR_INVOICE] ${resource} | eventId=${job.data.eventId}`);

    switch (resource) {
      case "invoice_xml": {
        const result = await this.processInvoiceXml(
          data as TCarInvoiceXmlPayload,
          branchId,
        );
        // Nota nova sem XML não completa (sairia da janela do sync e nunca mais entraria): reagenda até o máximo, depois failed.
        if (
          result !== TCAR_INVOICE_XML_UNAVAILABLE ||
          job.name !== TCAR_INVOICE_NEW_JOB_NAME
        ) {
          return;
        }
        // retryJobLater não conta como attempt no BullMQ, então o contador fica no próprio job.
        const attempts = (job.data.xmlUnavailableAttempts ?? 0) + 1;
        if (attempts >= TCAR_INVOICE_XML_MAX_ATTEMPTS) {
          throw new UnrecoverableError(
            `${TCAR_INVOICE_XML_UNAVAILABLE_FAILURE} após ${attempts} tentativas`,
          );
        }
        await job.updateData({ ...job.data, xmlUnavailableAttempts: attempts });
        console.warn(
          `[TCAR_INVOICE] XML ainda indisponível — job ${job.id} reagendado em ${TCAR_INVOICE_XML_RETRY_DELAY_MS / 60000}min (tentativa ${attempts}/${TCAR_INVOICE_XML_MAX_ATTEMPTS})`,
        );
        await this.retryJobLater(job, TCAR_INVOICE_XML_RETRY_DELAY_MS);
        return;
      }
      case "invoice_transfer":
        await this.processInvoiceTransfer(
          data as TCarInvoiceTransferPayload,
          branchId,
        );
        return;
      default:
        console.warn(`[TCAR_INVOICE] Resource não suportado: ${resource}`);
    }
  }

  // Nota sem XML esgotada é esperada (fica registrada como failed no Redis) — sem alerta por email.
  protected override onFailed(job: Job<TCarUpsertJobPayload>, error: Error): void {
    if (error.message.startsWith(TCAR_INVOICE_XML_UNAVAILABLE_FAILURE)) return;
    super.onFailed(job, error);
  }
}
