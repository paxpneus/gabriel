import { Job } from "bullmq";
import {
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

const INVOICE_UPDATE_REDELAY_MS = 5 * 1000;

/** Processa XMLs de nota em uma fila independente de produtos e clientes. */
export class TCarInvoiceQueue extends TCarUpsertQueue {
  constructor(options: { workless?: boolean } = {}) {
    super(options, "TCAR_INVOICE");
  }

  override async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, data, branchId } = job.data;

    // Nota nova é urgente (cliente/loja esperando ela existir); update de
    // nota já existente pode esperar de boa. Update se redelaya (libera o
    // slot de concurrency) enquanto houver nota nova pendente, em vez de
    // competir por um dos 2 slots do TCAR_INVOICE.
    if (
      job.name === TCAR_INVOICE_UPDATE_JOB_NAME &&
      (await this.hasPendingJobsNamed([TCAR_INVOICE_NEW_JOB_NAME]))
    ) {
      console.log(
        `[TCAR_INVOICE] Nota nova pendente — adiando update | eventId=${job.data.eventId}`,
      );
      return this.retryJobLater(job, INVOICE_UPDATE_REDELAY_MS);
    }

    console.log(`[TCAR_INVOICE] ${resource} | eventId=${job.data.eventId}`);

    switch (resource) {
      case "invoice_xml":
        await this.processInvoiceXml(data as TCarInvoiceXmlPayload, branchId);
        return;
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
}
