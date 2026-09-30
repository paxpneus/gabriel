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

/** Processa XMLs de nota em uma fila independente de produtos e clientes. */
export class TCarInvoiceQueue extends TCarUpsertQueue {
  constructor(options: { workless?: boolean } = {}) {
    super(options, "TCAR_INVOICE", 2);
  }

  override async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, data, branchId } = job.data;

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
