// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../config/redis", () => ({
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

// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})) },
}));

jest.mock("../../../fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { getCd21UnitBusiness: jest.fn() },
}));

jest.mock(
  "../../../../sales/pdv-management/sales-request/pdv-sales-request.service",
  () => ({
    __esModule: true,
    default: { resolveSaleInvoiceId: jest.fn() },
  }),
);

import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { ExpeditionBatchService } from "../batch.service";

describe("ExpeditionBatchService — lote pendente de saída pelo link CD21", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
      id: "cd21-id",
    });
  });

  it("searchCd21PendingOutgoing: delega pra searchPendingOutgoing escopado no CD21", async () => {
    const result = { data: [], total: 0 } as any;
    const spy = jest
      .spyOn(service, "searchPendingOutgoing")
      .mockResolvedValue(result);
    const params = { search: "x" } as any;

    await expect(service.searchCd21PendingOutgoing(params)).resolves.toBe(
      result,
    );
    expect(spy).toHaveBeenCalledWith(params, "cd21-id");
  });

  describe("addPdvSalesRequestToBatch", () => {
    it("lote que não é OUTGOING do CD21: rejeita sem resolver nota nem adicionar", async () => {
      const findOne = jest.spyOn(service, "findOne").mockResolvedValue(null);
      const add = jest.spyOn(service, "addInvoiceToBatch");

      await expect(
        service.addPdvSalesRequestToBatch("sr-1", "batch-x"),
      ).rejects.toThrow("Lote de saída do CD21 não encontrado");

      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "batch-x",
            unit_business_id: "cd21-id",
            type: "OUTGOING",
          },
        }),
      );
      expect(pdvSalesRequestService.resolveSaleInvoiceId).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it("nota sem xml_key: rejeita", async () => {
      jest.spyOn(service, "findOne").mockResolvedValue({ id: "batch-1" } as any);
      (pdvSalesRequestService.resolveSaleInvoiceId as jest.Mock).mockResolvedValue(
        "inv-1",
      );
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "inv-1",
        xml_key: null,
      });

      await expect(
        service.addPdvSalesRequestToBatch("sr-1", "batch-1"),
      ).rejects.toThrow("Nota de venda sem chave de acesso");
    });

    it("lote válido: adiciona a nota de venda (xml_key) ao lote informado no CD21", async () => {
      const batch = { id: "batch-1" } as any;
      jest.spyOn(service, "findOne").mockResolvedValue(batch);
      (pdvSalesRequestService.resolveSaleInvoiceId as jest.Mock).mockResolvedValue(
        "inv-1",
      );
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "inv-1",
        xml_key: "KEY-1",
      });
      const add = jest
        .spyOn(service, "addInvoiceToBatch")
        .mockResolvedValue(batch);

      await expect(
        service.addPdvSalesRequestToBatch("sr-1", "batch-1"),
      ).resolves.toBe(batch);
      expect(add).toHaveBeenCalledWith(
        ["KEY-1"],
        "cd21-id",
        "OUTGOING",
        "batch-1",
      );
    });
  });
});
