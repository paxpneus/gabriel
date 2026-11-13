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

jest.mock("../../shared/repositories/transfer-reference.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
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

const transferRepo = mockedTransferRepository as unknown as Record<string, jest.Mock>;
const attributesRepo = mockedAttributesRepository as unknown as Record<string, jest.Mock>;
// Mesmo nome `repo` do teste original: cada chamada vai pro repository que agora a atende.
const repo = {
  get findAll() { return transferRepo.findAll; },
  get findExistingTransferNumbers() { return transferRepo.findExistingTransferNumbers; },
  get findByTransferReferenceNumbers() { return transferRepo.findByTransferReferenceNumbers; },
  get updateWithAttributes() { return attributesRepo.updateWithAttributes; },
};
const t = { id: "tx" } as any;

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  repo.findByTransferReferenceNumbers.mockResolvedValue([]);
});

describe("escrita de transfer_invoice_reference (core.updateInvoices)", () => {
  it("updateInvoices: valida as notas alvo antes de gravar, na transação do chamador", async () => {
    repo.findAll.mockResolvedValue([{ id: "inv-1", number_system: "019794" }]);
    repo.findByTransferReferenceNumbers.mockResolvedValue([
      { id: "inv-other", number_system: "005743", transfer_number: "28921" },
    ]);

    await expect(
      invoiceService.updateInvoices(["inv-1"], "ub-1", { transfer_invoice_reference: "REF: 28921" }, undefined, t),
    ).rejects.toThrow("Revise a nota de transferência informada.");
    expect(repo.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ["inv-1"] }, attributes: ["id", "number_system"], transaction: t }),
      undefined,
      undefined,
    );
    expect(repo.updateWithAttributes).not.toHaveBeenCalled();
  });

  it.each([[null], [""], [undefined]])("updateInvoices limpando ou sem a referência (%p) → grava sem validar", async (reference) => {
    await invoiceService.updateInvoices(["inv-1"], "ub-1", { transfer_invoice_reference: reference } as any);

    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.updateWithAttributes).toHaveBeenCalled();
  });
});
