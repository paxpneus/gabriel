// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../config/redis", () => ({
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

// Troca de principal: transação roda o callback direto; auditoria e enqueue do sync mockados.
jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb({})) },
}));
jest.mock("../../../global/audit-logs/audit-log.service", () => ({
  __esModule: true,
  default: { record: jest.fn() },
}));
jest.mock("../../manual-import/manual-import.service", () => ({
  __esModule: true,
  default: { enqueueProductSync: jest.fn() },
}));

// IntegrationMapping (*.model.ts) é auto-mocado globalmente via
// src/__tests__/setup.ts — usa o model direto (via o repository real,
// que é só um wrapper fino) pra testar a lógica de matching de verdade.

import IntegrationMapping from "../integration-mapping.model";
import { IntegrationMappingService } from "../integration-mapping.service";
import manualImportService from "../../manual-import/manual-import.service";

describe("IntegrationMappingService.createOrUpdateIntegrationMapping", () => {
  let service: IntegrationMappingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntegrationMappingService();
  });

  it("sem mapping nenhum pra esse external_id: cria", async () => {
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(null);
    (IntegrationMapping.create as jest.Mock).mockResolvedValue({
      id: "new-mapping-id",
    });

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entity_type: "PRODUCT",
          integrations_id: "tecinco-integration",
          external_id: "13216",
        },
      }),
    );
    expect(IntegrationMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "PRODUCT",
        internal_id: "product-1",
        integrations_id: "tecinco-integration",
        external_id: "13216",
      }),
      expect.anything(),
    );
    expect(result).toEqual({ id: "new-mapping-id" });
  });

  it("já existe mapping pra esse external_id, mesmo internal_id: idempotente, não recria", async () => {
    const existing = { id: "existing-id", internal_id: "product-1", external_id: "13216" };
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(existing);

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("já existe mapping pra esse external_id apontando pra OUTRO internal_id: não reaponta, devolve o existente (proteção contra reatribuição errada)", async () => {
    const existing = { id: "existing-id", internal_id: "other-product", external_id: "13216" };
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(existing);
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("13216"));
  });

  it("o mesmo internal_id JÁ TEM mapping pra outro external_id: cria um novo mesmo assim (Tecinco reaproveita/duplica epctb_codigo pro mesmo produto físico — não é mais bloqueado por internal_id)", async () => {
    // findOne é escopado por external_id — o mapping existente é pra um
    // external_id diferente do que está sendo criado agora, então não bate
    // e a query retorna null pra esse external_id específico.
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(null);
    (IntegrationMapping.create as jest.Mock).mockResolvedValue({
      id: "second-mapping-id",
    });

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1", // já tinha mapping pro external_id "20517"
      integrations_id: "tecinco-integration",
      external_id: "13216", // novo código, mesmo produto
    });

    expect(IntegrationMapping.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entity_type: "PRODUCT",
          integrations_id: "tecinco-integration",
          external_id: "13216",
        },
      }),
    );
    expect(IntegrationMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({ internal_id: "product-1", external_id: "13216" }),
      expect.anything(),
    );
    expect(result).toEqual({ id: "second-mapping-id" });
  });
});

describe("IntegrationMappingService.updateForProduct — sync do novo principal", () => {
  let service: IntegrationMappingService;
  const queues = {} as any;
  const enqueue = manualImportService.enqueueProductSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntegrationMappingService();
    (IntegrationMapping.findAll as jest.Mock).mockResolvedValue([{ id: "old-primary", external_id: "100" }]);
    (IntegrationMapping.findByPk as jest.Mock).mockResolvedValue({
      update: jest.fn().mockResolvedValue({ id: "m-2", is_primary: true }),
    });
  });

  it("marcou como principal: enfileira o sync do código na integração depois do commit", async () => {
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue({
      id: "m-2", integrations_id: "tecinco", external_id: "27314", is_primary: false,
    });
    enqueue.mockResolvedValue({ queue: "tcarApiFetch", jobId: "j" });

    const result = await service.updateForProduct("m-2", "product-1", { is_primary: true }, "user-1", queues);

    expect(result).toEqual({ id: "m-2", is_primary: true });
    expect(enqueue).toHaveBeenCalledWith("tecinco", "27314", queues);
  });

  it("já era o principal: não enfileira nada", async () => {
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue({
      id: "m-2", integrations_id: "tecinco", external_id: "27314", is_primary: true,
    });

    await service.updateForProduct("m-2", "product-1", { is_primary: true }, "user-1", queues);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("falha ao enfileirar não derruba a troca do principal", async () => {
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue({
      id: "m-2", integrations_id: "tecinco", external_id: "27314", is_primary: false,
    });
    enqueue.mockRejectedValue(new Error("API fora"));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      service.updateForProduct("m-2", "product-1", { is_primary: true }, "user-1", queues),
    ).resolves.toEqual({ id: "m-2", is_primary: true });
  });
});
