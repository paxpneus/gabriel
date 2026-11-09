// Mocks de Redis/BullMQ: a cadeia de imports do scan-logs abre filas reais e o Jest não sai sem eles.
jest.mock("../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), eval: jest.fn(), on: jest.fn() },
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
  default: { transaction: jest.fn((cb: any) => cb({ LOCK: { UPDATE: "UPDATE" } })) },
}));

import { ExpeditionScanLogService } from "../scan-logs.service";

// Etiqueta de 41+ caracteres: nota nas posições 14-22, volume nas 35-41.
const LABEL = "00000000000000" + "00005452" + "0000000000000" + "000001";

describe("ExpeditionScanLogService.scanProduct — etiqueta já lida", () => {
  let service: ExpeditionScanLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionScanLogService();
  });

  it("procura a etiqueta só no lote atual (a mesma caixa é bipada na emissora e no CD)", async () => {
    const findOne = jest.spyOn(service, "findOne").mockResolvedValue({ id: "log-1" } as any);

    await expect(service.scanProduct(LABEL, "789", "batch-cd", "user-1", null)).rejects.toThrow(
      "Volume 000001 já lido no lote para nota 00005452",
    );
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { label_full_code: LABEL, expedition_batch_id: "batch-cd" } }),
    );
  });
});
