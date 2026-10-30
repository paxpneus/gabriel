// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../../config/redis", () => ({
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


jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})), literal: jest.fn((value: string) => value) },
}));

jest.mock("../invoice.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
    updateWithAttributes: jest.fn(),
    bulkUpdate: jest.fn(),
  },
}));

import mockedRepository from "../invoice.repository";
import invoiceService from "../invoice.service";

const repo = mockedRepository as unknown as Record<string, jest.Mock>;
const t = { id: "tx" } as any;

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  repo.findByTransferReferenceNumbers.mockResolvedValue([]);
});

describe("InvoiceService.assertTransferReferences", () => {
  it("consulta existência e uso numa query cada, com os números distintos; problema → erro", async () => {
    repo.findByTransferReferenceNumbers.mockResolvedValue([
      { id: "inv-other", number_system: "005743", transfer_number: "28921" },
    ]);

    await expect(
      invoiceService.assertTransferReferences(
        [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: "REF: 028921" }],
        "Fim.",
      ),
    ).rejects.toThrow(
      "Nota(s) de transferência já vinculadas a outra nota de venda: 28921 (ref. a nota de venda 019794, já usada pela nota de venda 005743). Fim.",
    );
    expect(repo.findExistingTransferNumbers).toHaveBeenCalledWith(["28921"]);
    expect(repo.findByTransferReferenceNumbers).toHaveBeenCalledWith(["28921"]);
  });

  it("checkAlreadyUsed: false → uso nem é consultado (lista vazia)", async () => {
    await invoiceService.assertTransferReferences(
      [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: "REF: 28921" }],
      "Fim.",
      { checkAlreadyUsed: false },
    );
    expect(repo.findByTransferReferenceNumbers).toHaveBeenCalledWith([]);
  });
});

describe("escrita de transfer_invoice_reference (PUT /:id, PUT /bulk, lote)", () => {
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

  it("bulkUpdate: valida as notas do where; ok → grava", async () => {
    repo.findAll.mockResolvedValue([{ id: "inv-1", number_system: "019794" }]);

    await invoiceService.bulkUpdate({ transfer_invoice_reference: "REF: 28921" }, { where: { id: ["inv-1"] } });

    expect(repo.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ["inv-1"] } }), undefined, undefined);
    expect(repo.bulkUpdate).toHaveBeenCalled();
  });

  it("bulkUpdate com transferência inexistente → erro sem gravar", async () => {
    repo.findAll.mockResolvedValue([{ id: "inv-1", number_system: "019794" }]);
    repo.findExistingTransferNumbers.mockResolvedValue(new Set());

    await expect(
      invoiceService.bulkUpdate({ transfer_invoice_reference: "REF: 99" }, { where: { id: ["inv-1"] } }),
    ).rejects.toThrow("Nota(s) de transferência entre lojas não encontradas no sistema: 99 (ref. a nota de venda 019794).");
    expect(repo.bulkUpdate).not.toHaveBeenCalled();
  });
});
