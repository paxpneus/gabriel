// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
    scan: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));


jest.mock("../../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})), literal: jest.fn((value: string) => value) },
}));

jest.mock("../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service", () => ({
  __esModule: true,
  default: { findTransferLinkableBySaleInvoiceIds: jest.fn(), setTransferInvoiceFromInvoiceFlow: jest.fn() },
}));

jest.mock("../../shared/repositories/transfer-reference.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
    findTransfersByIds: jest.fn(),
    findByTransferInvoiceIds: jest.fn(),
  },
}));

jest.mock("../../shared/repositories/invoice-attributes.repository", () => ({
  __esModule: true,
  default: {
    updateWithAttributes: jest.fn(),
  },
}));

import mockedTransferRepository from "../../shared/repositories/transfer-reference.repository";
import mockedAttributesRepository from "../../shared/repositories/invoice-attributes.repository";
import invoiceService from "../services/invoice.service";
import mockedPdvService from "../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { transferReferenceService } from "../../shared";
import { AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";

const transferRepo = mockedTransferRepository as unknown as Record<string, jest.Mock>;
const attributesRepo = mockedAttributesRepository as unknown as Record<string, jest.Mock>;
// Mesmo nome `repo` do teste original: cada chamada vai pro repository que agora a atende.
const repo = {
  get findAll() { return transferRepo.findAll; },
  get findExistingTransferNumbers() { return transferRepo.findExistingTransferNumbers; },
  get findByTransferReferenceNumbers() { return transferRepo.findByTransferReferenceNumbers; },
  get findTransfersByIds() { return transferRepo.findTransfersByIds; },
  get findByTransferInvoiceIds() { return transferRepo.findByTransferInvoiceIds; },
  get updateWithAttributes() { return attributesRepo.updateWithAttributes; },
};
const t = { id: "tx" } as any;

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  repo.findByTransferReferenceNumbers.mockResolvedValue([]);
  repo.findTransfersByIds.mockResolvedValue([{ id: "tr-1", number_system: "028921", normalized_number: "28921" }]);
  repo.findByTransferInvoiceIds.mockResolvedValue([]);
});

describe("escrita do vínculo de transferência (core.updateInvoices)", () => {
  const pdv = mockedPdvService as unknown as Record<string, jest.Mock>;
  const actor = { userId: "user-1", roleId: "role-1", origin: AuditOrigin.USER };
  let link: jest.SpyInstance;

  beforeEach(() => {
    pdv.findTransferLinkableBySaleInvoiceIds.mockResolvedValue([]);
    link = jest.spyOn(transferReferenceService, "linkTransferInvoice").mockResolvedValue(undefined);
  });

  it("nota sem solicitação no PDV → grava direto na transação do chamador; resto do body nos atributos", async () => {
    await invoiceService.updateInvoices(["inv-1"], "ub-1", { transfer_invoice_id: "tr-1", status: "OPEN" } as any, undefined, t, actor);

    expect(pdv.setTransferInvoiceFromInvoiceFlow).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith(["inv-1"], "tr-1", actor, t);
    expect(repo.updateWithAttributes).toHaveBeenCalledWith(["inv-1"], "ub-1", { status: "OPEN" }, undefined, t);
  });

  it("nota com solicitação no PDV → vai pelo PDV (status/sincronia da solicitação), não grava direto", async () => {
    const request = { id: "req-1", sale_invoice_id: "inv-1" };
    pdv.findTransferLinkableBySaleInvoiceIds.mockResolvedValue([request]);

    await invoiceService.updateInvoices(["inv-1"], "ub-1", { transfer_invoice_id: null }, undefined, t, actor);

    expect(pdv.setTransferInvoiceFromInvoiceFlow).toHaveBeenCalledWith(request, null, actor);
    expect(link).not.toHaveBeenCalled();
  });

  it("erro do PDV (fora da etapa) → propaga sem gravar nada", async () => {
    pdv.findTransferLinkableBySaleInvoiceIds.mockResolvedValue([{ id: "req-1", sale_invoice_id: "inv-1" }]);
    pdv.setTransferInvoiceFromInvoiceFlow.mockRejectedValueOnce(new Error("resolva pelo PDV"));

    await expect(
      invoiceService.updateInvoices(["inv-1"], "ub-1", { transfer_invoice_id: "tr-1" }, undefined, t, actor),
    ).rejects.toThrow("resolva pelo PDV");
    expect(repo.updateWithAttributes).not.toHaveBeenCalled();
  });

  it("sem os campos do vínculo → nem consulta o PDV", async () => {
    await invoiceService.updateInvoices(["inv-1"], "ub-1", { status: "OPEN" } as any);

    expect(pdv.findTransferLinkableBySaleInvoiceIds).not.toHaveBeenCalled();
    expect(repo.updateWithAttributes).toHaveBeenCalled();
  });
});
