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

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

const fakeTransaction = { commit: jest.fn(), rollback: jest.fn() };

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn(),
    where: jest.fn(),
    fn: jest.fn(),
    col: jest.fn(),
    define: jest.fn(() => class {}),
    authenticate: jest.fn(),
    sync: jest.fn(),
    query: jest.fn(),
    close: jest.fn(),
    getQueryInterface: jest.fn(),
    models: {},
    modelManager: { addModel: jest.fn(), getModel: jest.fn() },
    literal: jest.fn((value: string) => value),
  },
}));

jest.mock("../invoice.repository", () => ({
  __esModule: true,
  default: {
    findOutgoingByXmlKey: jest.fn(),
    findCancellationTargetById: jest.fn(),
    updateWithAttributesForAllUnits: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("../../../../expedition/batch-invoices/batch-invoices.service", () => ({
  __esModule: true,
  default: { removeBatchInvoice: jest.fn() },
}));

jest.mock("../../../../../company/events/event/event.service", () => ({
  __esModule: true,
  default: { notifyByRoles: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { notifyByRoles: jest.fn().mockResolvedValue(undefined) },
}));

import sequelize from "../../../../../../config/sequelize";
import mockedRepository from "../invoice.repository";
import batchInvoicesService from "../../../../expedition/batch-invoices/batch-invoices.service";
import invoiceService from "../invoice.service";
import { InvoiceCancellationTarget } from "../invoice.types";

const repo = mockedRepository as unknown as {
  findOutgoingByXmlKey: jest.Mock;
  findCancellationTargetById: jest.Mock;
  updateWithAttributesForAllUnits: jest.Mock;
  update: jest.Mock;
};
const removeBatchInvoice = batchInvoicesService.removeBatchInvoice as jest.Mock;

const RETURN_INVOICE = { id: "return-1", number_system: "020284" };
const REF_KEY = "31261002316749002111550020000191421000000000";

const makeOutgoing = (
  overrides: Partial<InvoiceCancellationTarget> = {},
): InvoiceCancellationTarget => ({
  id: "outgoing-1",
  number_system: "019142",
  return_invoice_reference: null,
  statuses: ["FINISHED"],
  batchInvoiceId: null,
  batchStatus: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (sequelize.transaction as jest.Mock).mockImplementation(
    async (callback: (t: unknown) => unknown) => callback(fakeTransaction),
  );
  repo.updateWithAttributesForAllUnits.mockResolvedValue(undefined);
  repo.update.mockResolvedValue({});
  removeBatchInvoice.mockResolvedValue(undefined);
});

describe("InvoiceService.bondReturnInvoice", () => {
  it("cancela a nota de saída referenciada e grava return_invoice_reference nas duas notas", async () => {
    repo.findOutgoingByXmlKey.mockResolvedValue(makeOutgoing());

    const result = await invoiceService.bondReturnInvoice(
      RETURN_INVOICE,
      REF_KEY,
    );

    expect(result).toBe("outgoing-1");
    expect(repo.findOutgoingByXmlKey).toHaveBeenCalledWith(REF_KEY);
    expect(repo.updateWithAttributesForAllUnits).toHaveBeenCalledWith(
      ["outgoing-1"],
      { return_invoice_reference: "020284", status: "CANCELLED" },
      { type: "OUTGOING" },
      fakeTransaction,
    );
    expect(repo.update).toHaveBeenCalledWith(
      "return-1",
      { return_invoice_reference: "019142" },
      { transaction: fakeTransaction },
    );
    expect(removeBatchInvoice).not.toHaveBeenCalled();
  });

  it("nota de saída sem cadastro: não faz nada", async () => {
    repo.findOutgoingByXmlKey.mockResolvedValue(null);

    const result = await invoiceService.bondReturnInvoice(
      RETURN_INVOICE,
      REF_KEY,
    );

    expect(result).toBeNull();
    expect(repo.updateWithAttributesForAllUnits).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("já cancelada e vinculada a esta devolução (reprocesso/retry): não regrava, mas retorna o id pro PDV", async () => {
    repo.findOutgoingByXmlKey.mockResolvedValue(
      makeOutgoing({ statuses: ["CANCELLED"], return_invoice_reference: "20284" }),
    );

    const result = await invoiceService.bondReturnInvoice(
      RETURN_INVOICE,
      REF_KEY,
    );

    expect(result).toBe("outgoing-1");
    expect(repo.updateWithAttributesForAllUnits).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("em lote aberto: tira do lote antes de gravar CANCELLED (removeBatchInvoice volta pra OPEN)", async () => {
    repo.findOutgoingByXmlKey.mockResolvedValue(
      makeOutgoing({ batchInvoiceId: "bi-1", batchStatus: "OPEN" }),
    );

    await invoiceService.bondReturnInvoice(RETURN_INVOICE, REF_KEY);

    expect(removeBatchInvoice).toHaveBeenCalledWith("bi-1", fakeTransaction);
    expect(removeBatchInvoice.mock.invocationCallOrder[0]).toBeLessThan(
      repo.updateWithAttributesForAllUnits.mock.invocationCallOrder[0],
    );
  });

  it("em lote finalizado: mantém no lote e cancela mesmo assim", async () => {
    repo.findOutgoingByXmlKey.mockResolvedValue(
      makeOutgoing({ batchInvoiceId: "bi-1", batchStatus: "FINISHED" }),
    );

    const result = await invoiceService.bondReturnInvoice(
      RETURN_INVOICE,
      REF_KEY,
    );

    expect(result).toBe("outgoing-1");
    expect(removeBatchInvoice).not.toHaveBeenCalled();
    expect(repo.updateWithAttributesForAllUnits).toHaveBeenCalled();
  });
});

describe("InvoiceService.cancelInvoice", () => {
  it("cancelada na integração: grava CANCELLED direto em todas as unit businesses, sem devolução", async () => {
    repo.findCancellationTargetById.mockResolvedValue(
      makeOutgoing({ statuses: ["OPEN"] }),
    );

    await invoiceService.cancelInvoice("outgoing-1");

    expect(repo.findCancellationTargetById).toHaveBeenCalledWith("outgoing-1");
    expect(repo.updateWithAttributesForAllUnits).toHaveBeenCalledWith(
      ["outgoing-1"],
      { status: "CANCELLED" },
      undefined,
      fakeTransaction,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("em lote aberto: tira do lote antes do CANCELLED", async () => {
    repo.findCancellationTargetById.mockResolvedValue(
      makeOutgoing({ statuses: ["PENDING"], batchInvoiceId: "bi-1", batchStatus: "OPEN" }),
    );

    await invoiceService.cancelInvoice("outgoing-1");

    expect(removeBatchInvoice).toHaveBeenCalledWith("bi-1", fakeTransaction);
    expect(removeBatchInvoice.mock.invocationCallOrder[0]).toBeLessThan(
      repo.updateWithAttributesForAllUnits.mock.invocationCallOrder[0],
    );
  });

  it("em lote finalizado: mantém no lote e cancela", async () => {
    repo.findCancellationTargetById.mockResolvedValue(
      makeOutgoing({ statuses: ["FINISHED"], batchInvoiceId: "bi-1", batchStatus: "FINISHED" }),
    );

    await invoiceService.cancelInvoice("outgoing-1");

    expect(removeBatchInvoice).not.toHaveBeenCalled();
    expect(repo.updateWithAttributesForAllUnits).toHaveBeenCalled();
  });

  it("já CANCELLED e fora de lote aberto (reprocesso): não faz nada", async () => {
    repo.findCancellationTargetById.mockResolvedValue(
      makeOutgoing({ statuses: ["CANCELLED"] }),
    );

    await invoiceService.cancelInvoice("outgoing-1");

    expect(repo.updateWithAttributesForAllUnits).not.toHaveBeenCalled();
    expect(removeBatchInvoice).not.toHaveBeenCalled();
  });

  it("nota inexistente: não faz nada", async () => {
    repo.findCancellationTargetById.mockResolvedValue(null);

    await invoiceService.cancelInvoice("missing");

    expect(repo.updateWithAttributesForAllUnits).not.toHaveBeenCalled();
  });
});
