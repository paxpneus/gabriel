// Mocks de infraestrutura (Redis/BullMQ): sem eles o import abre conexão real e o Jest não sai.
jest.mock("../../../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn() },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

import Invoice from "../../invoice.model";
import transferReferenceRepository from "../repositories/transfer-reference.repository";

describe("TransferReferenceRepository.findForTransferLink", () => {
  const transaction = { LOCK: { UPDATE: "UPDATE", NO_KEY_UPDATE: "NO KEY UPDATE" } } as any;

  afterEach(() => jest.restoreAllMocks());

  // O lote já segura KEY SHARE na nota (FK de expedition_batch_invoices); FOR UPDATE de outra conexão esperava por ele pra sempre.
  it("trava a nota com NO KEY UPDATE (não conflita com o KEY SHARE do lote)", async () => {
    const findAll = jest.spyOn(Invoice, "findAll").mockResolvedValue([]);

    await transferReferenceRepository.findForTransferLink(["inv-1"], transaction);

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ lock: "NO KEY UPDATE", transaction }));
  });

  it("sem lock (leitura do depois da auditoria) não pede trava", async () => {
    const findAll = jest.spyOn(Invoice, "findAll").mockResolvedValue([]);

    await transferReferenceRepository.findForTransferLink(["inv-1"], transaction, false);

    expect(findAll.mock.calls[0][0]).not.toHaveProperty("lock");
  });
});
