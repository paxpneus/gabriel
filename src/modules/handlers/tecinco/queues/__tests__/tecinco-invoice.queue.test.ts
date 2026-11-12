import { Job } from "bullmq";

// Base mockada: o teste só cobre a decisão de reagendar em TCarInvoiceQueue.process.
jest.mock("../tecinco-api-fetch.queue", () => {
  class TCarUpsertQueue {
    processInvoiceXml = jest.fn();
    processInvoiceTransfer = jest.fn();
    ensureProductsFromInvoiceItems = jest.fn();
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

// Dependências do processInternalInvoice: fachada de invoice, PDV e itens puxam Redis/BullMQ reais se não forem mockados.
const getNotaFiscalMock = jest.fn();
jest.mock("../../service/conferencias-estoque/conferencias-estoque.service", () => ({
  __esModule: true,
  TCarConferenciaEstoqueService: jest.fn().mockImplementation(() => ({ getNotaFiscal: getNotaFiscalMock })),
}));
jest.mock("../helpers/customer.helper", () => ({
  __esModule: true,
  upsertCustomerFromTCar: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../helpers/lookup-cache", () => ({
  __esModule: true,
  getCachedTCarIntegration: jest.fn().mockResolvedValue({ id: "tecinco-id" }),
  getCachedUnitBusinessByNumber: jest.fn(),
}));
jest.mock("../../../../warehouse/fiscal/invoices/invoice", () => ({
  __esModule: true,
  internalInvoiceService: { upsertInternalInvoice: jest.fn() },
  invoiceCancellationService: { cancelInvoice: jest.fn() },
}));
jest.mock("../../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service", () => ({
  __esModule: true,
  default: { syncBatchesByInvoiceIds: jest.fn() },
}));
jest.mock("../../../../sales/pdv-management/sales-request/pdv-sales-request.service", () => ({
  __esModule: true,
  default: { handleInvoiceCancelled: jest.fn(), syncCriticalErrorByInvoiceIds: jest.fn() },
}));

import { UnrecoverableError } from "bullmq";
import { getCachedUnitBusinessByNumber } from "../helpers/lookup-cache";
import {
  internalInvoiceService,
  invoiceCancellationService,
} from "../../../../warehouse/fiscal/invoices/invoice";
import invoiceItemsService from "../../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
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

// Detalhe da nota 882 (série B) visto pela filial da listagem: filial = loja que listou, cliente = a outra loja.
function buildInternalDetail(overrides: Record<string, unknown> = {}) {
  return {
    chave: { nota: 882, serie: "B", seq_cancelamento: "0" },
    filial: { codigo: 12, nome: "PAX LOJA 12" },
    cabecalho: { emissao: "2026-10-31", situacao: "A", entrada_saida: "S" },
    cliente: { codigo: 77332, nome: "PAX LOJA 24", cnpj_cpf: "02.316.749/0024-63" },
    itens: [{ epeit_seq: 1, epctb_codigo: "20302", epeit_qtdade: 4 }],
    ...overrides,
  };
}

function buildInternalJob(entradaSaida: "E" | "S", branchId = 12): Job<any> {
  return {
    id: `invoice-internal-new-${branchId}-${entradaSaida}-882`,
    name: "invoice-internal-new",
    data: {
      eventId: "evt",
      resource: "invoice_internal",
      action: "sync",
      companyId: "default",
      branchId,
      data: { numero: 882, entrada_saida: entradaSaida, serie: "B", seq_cancelamento: "0", cln_codigo: 77332 },
    },
    updateData: jest.fn(),
  } as unknown as Job<any>;
}

describe("TCarInvoiceQueue.process — nota interna (série B)", () => {
  let queue: any;
  const upsert = internalInvoiceService.upsertInternalInvoice as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new TCarInvoiceQueue({ workless: true });
    queue.ensureProductsFromInvoiceItems.mockResolvedValue({
      operationalItems: [{ product_id: "product-1", quantity_expected: 4, item_number: 1 }],
      unmappedItems: [],
    });
    (getCachedUnitBusinessByNumber as jest.Mock).mockResolvedValue({ cnpj: "02316749001220", name: "Loja 12" });
    upsert.mockResolvedValue("invoice-1");
  });

  it("S: a filial é a emitente; busca pela chave composta e sincroniza PDV e lote depois do upsert", async () => {
    getNotaFiscalMock.mockResolvedValue({ data: buildInternalDetail() });

    await queue.process(buildInternalJob("S"));

    expect(getNotaFiscalMock).toHaveBeenCalledWith(882, 12, { serie: "B", seq_cancelamento: "0", cln_codigo: 77332 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        numero: "882",
        invoiceType: "OUTGOING",
        sender: { cnpj: "02316749001220", name: "PAX LOJA 12" },
        receiver: { cnpj: "02316749002463", name: "PAX LOJA 24" },
        integrationsId: "tecinco-id",
        cancelled: false,
      }),
    );
    expect(invoiceCancellationService.cancelInvoice).not.toHaveBeenCalled();
    expect(pdvSalesRequestService.syncCriticalErrorByInvoiceIds).toHaveBeenCalledWith(["invoice-1"]);
    expect(invoiceItemsService.syncBatchesByInvoiceIds).toHaveBeenCalledWith(["invoice-1"]);
  });

  it("E: o cliente (outra loja) é o emitente e a filial é a destinatária", async () => {
    (getCachedUnitBusinessByNumber as jest.Mock).mockResolvedValue({ cnpj: "02316749002463", name: "Loja 24" });
    getNotaFiscalMock.mockResolvedValue({
      data: buildInternalDetail({
        filial: { codigo: 24, nome: "PAX LOJA 24" },
        cliente: { codigo: 1, nome: "PAX LOJA 12", cnpj_cpf: "02316749001220" },
      }),
    });

    await queue.process(buildInternalJob("E", 24));

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceType: "INCOMING",
        sender: { cnpj: "02316749001220", name: "PAX LOJA 12" },
        receiver: { cnpj: "02316749002463", name: "PAX LOJA 24" },
      }),
    );
  });

  it.each([
    ["cabecalho.situacao C", { cabecalho: { emissao: "2026-10-31", situacao: "C" } }],
    ["fiscal.situacao_nfe C", { fiscal: { situacao_nfe: "C" } }],
    ["seq_cancelamento ≠ 0", { chave: { nota: 882, serie: "B", seq_cancelamento: "1" } }],
  ])("cancelada (%s): grava cancelada, cancela a nota e avisa o PDV", async (_label, overrides) => {
    getNotaFiscalMock.mockResolvedValue({ data: buildInternalDetail(overrides) });

    await queue.process(buildInternalJob("S"));

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
    expect(invoiceCancellationService.cancelInvoice).toHaveBeenCalledWith("invoice-1");
    expect(pdvSalesRequestService.handleInvoiceCancelled).toHaveBeenCalledWith("invoice-1");
  });

  it("nota sem item de pneu (ensureProducts vazio) não é gravada", async () => {
    getNotaFiscalMock.mockResolvedValue({ data: buildInternalDetail() });
    queue.ensureProductsFromInvoiceItems.mockResolvedValue({ operationalItems: [], unmappedItems: [] });

    await queue.process(buildInternalJob("S"));

    expect(upsert).not.toHaveBeenCalled();
  });

  it("cliente sem CNPJ não grava (sem id_system canônico)", async () => {
    getNotaFiscalMock.mockResolvedValue({ data: buildInternalDetail({ cliente: { codigo: 1, nome: "X" } }) });

    await queue.process(buildInternalJob("S"));

    expect(upsert).not.toHaveBeenCalled();
  });

  it("404 na Tecinco: completa sem gravar; outro erro sobe pro retry", async () => {
    getNotaFiscalMock.mockRejectedValueOnce({ response: { status: 404 } });
    await queue.process(buildInternalJob("S"));
    expect(upsert).not.toHaveBeenCalled();

    getNotaFiscalMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(queue.process(buildInternalJob("S"))).rejects.toThrow("timeout");
  });
});
