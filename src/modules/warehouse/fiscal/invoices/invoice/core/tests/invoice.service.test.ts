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

jest.mock("../repositories/invoice.repository", () => ({
  __esModule: true,
  default: {
    bulkUpdate: jest.fn(),
  },
}));

jest.mock("../../shared/repositories/transfer-reference.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
  },
}));

import mockedRepository from "../repositories/invoice.repository";
import mockedTransferReferenceRepository from "../../shared/repositories/transfer-reference.repository";
import invoiceService from "../services/invoice.service";

const repo = mockedRepository as unknown as Record<string, jest.Mock>;
const transferRepo = mockedTransferReferenceRepository as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  transferRepo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  transferRepo.findByTransferReferenceNumbers.mockResolvedValue([]);
});

describe("escrita de transfer_invoice_reference (PUT /bulk)", () => {
  it("bulkUpdate: valida as notas do where; ok → grava", async () => {
    transferRepo.findAll.mockResolvedValue([{ id: "inv-1", number_system: "019794" }]);

    await invoiceService.bulkUpdate({ transfer_invoice_reference: "REF: 28921" }, { where: { id: ["inv-1"] } });

    expect(transferRepo.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ["inv-1"] } }), undefined, undefined);
    expect(repo.bulkUpdate).toHaveBeenCalled();
  });

  it("bulkUpdate com transferência inexistente → erro sem gravar", async () => {
    transferRepo.findAll.mockResolvedValue([{ id: "inv-1", number_system: "019794" }]);
    transferRepo.findExistingTransferNumbers.mockResolvedValue(new Set());

    await expect(
      invoiceService.bulkUpdate({ transfer_invoice_reference: "REF: 99" }, { where: { id: ["inv-1"] } }),
    ).rejects.toThrow("Nota(s) de transferência entre lojas não encontradas no sistema: 99 (ref. a nota de venda 019794).");
    expect(repo.bulkUpdate).not.toHaveBeenCalled();
  });
});
