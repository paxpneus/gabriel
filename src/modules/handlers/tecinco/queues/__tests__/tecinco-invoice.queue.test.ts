import { Job } from "bullmq";

// Base mockada: o teste só cobre a decisão de reagendar em TCarInvoiceQueue.process.
jest.mock("../tecinco-api-fetch.queue", () => {
  class TCarUpsertQueue {
    processInvoiceXml = jest.fn();
    processInvoiceTransfer = jest.fn();
    retryJobLater = jest.fn();
    // Método (não campo) pra não esconder o override de TCarInvoiceQueue.
    onFailed(_job: unknown, _error: Error) {}
  }
  return {
    __esModule: true,
    TCarUpsertQueue,
    TCAR_INVOICE_XML_UNAVAILABLE: "xml_unavailable",
  };
});

import { UnrecoverableError } from "bullmq";
import {
  TCarInvoiceQueue,
  TCAR_INVOICE_NEW_JOB_NAME,
  TCAR_INVOICE_UPDATE_JOB_NAME,
  TCAR_INVOICE_XML_MAX_ATTEMPTS,
  TCAR_INVOICE_XML_RETRY_DELAY_MS,
  TCAR_INVOICE_XML_UNAVAILABLE_FAILURE,
} from "../tecinco-invoice.queue";
import { TCAR_INVOICE_XML_UNAVAILABLE } from "../tecinco-api-fetch.queue";

function buildJob(name: string, xmlUnavailableAttempts?: number): Job<any> {
  return {
    id: "invoice-new-12-S-29203",
    name,
    data: {
      eventId: "evt",
      resource: "invoice_xml",
      action: "sync",
      companyId: "default",
      branchId: 12,
      data: { numero: 29203, entrada_saida: "S" },
      ...(xmlUnavailableAttempts !== undefined ? { xmlUnavailableAttempts } : {}),
    },
    updateData: jest.fn(),
  } as unknown as Job<any>;
}

describe("TCarInvoiceQueue.process — nota sem XML", () => {
  let queue: any;

  beforeEach(() => {
    queue = new TCarInvoiceQueue({ workless: true });
  });

  it("nota nova sem XML: reagenda o job em vez de completar e conta a tentativa", async () => {
    queue.processInvoiceXml.mockResolvedValue(TCAR_INVOICE_XML_UNAVAILABLE);
    const job = buildJob(TCAR_INVOICE_NEW_JOB_NAME);

    await queue.process(job);

    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ xmlUnavailableAttempts: 1 }),
    );
    expect(queue.retryJobLater).toHaveBeenCalledWith(
      job,
      TCAR_INVOICE_XML_RETRY_DELAY_MS,
    );
  });

  it("nota nova sem XML na última tentativa: falha (UnrecoverableError) sem reagendar", async () => {
    queue.processInvoiceXml.mockResolvedValue(TCAR_INVOICE_XML_UNAVAILABLE);
    const job = buildJob(
      TCAR_INVOICE_NEW_JOB_NAME,
      TCAR_INVOICE_XML_MAX_ATTEMPTS - 1,
    );

    const promise = queue.process(job);

    await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(promise).rejects.toThrow(TCAR_INVOICE_XML_UNAVAILABLE_FAILURE);
    expect(queue.retryJobLater).not.toHaveBeenCalled();
  });

  it("falha por XML esgotado não manda alerta; outras falhas seguem pro alerta da base", () => {
    const job = buildJob(TCAR_INVOICE_NEW_JOB_NAME);
    const baseOnFailed = jest.spyOn(
      Object.getPrototypeOf(TCarInvoiceQueue.prototype),
      "onFailed",
    );

    queue.onFailed(job, new Error(`${TCAR_INVOICE_XML_UNAVAILABLE_FAILURE} após 5 tentativas`));
    expect(baseOnFailed).not.toHaveBeenCalled();

    queue.onFailed(job, new Error("Request failed with status code 500"));
    expect(baseOnFailed).toHaveBeenCalledTimes(1);
  });

  it("nota nova com XML processado: completa sem reagendar", async () => {
    queue.processInvoiceXml.mockResolvedValue(undefined);

    await queue.process(buildJob(TCAR_INVOICE_NEW_JOB_NAME));

    expect(queue.retryJobLater).not.toHaveBeenCalled();
  });

  it("update de nota sem XML: não reagenda (só nota nova fica em retry)", async () => {
    queue.processInvoiceXml.mockResolvedValue(TCAR_INVOICE_XML_UNAVAILABLE);

    await queue.process(buildJob(TCAR_INVOICE_UPDATE_JOB_NAME));

    expect(queue.retryJobLater).not.toHaveBeenCalled();
  });
});
