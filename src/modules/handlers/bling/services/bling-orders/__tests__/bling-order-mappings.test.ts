// Infra mockada pelo mesmo motivo de bling-order.service.test.ts: o import puxa filas BullMQ.
jest.mock("../../../../../../config/redis", () => ({
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

jest.mock("../../../../../integrations/integration-mapping/integration-mapping.service", () => ({
  __esModule: true,
  default: {
    createOrUpdateIntegrationMapping: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../../../../magentoV2/api/magentoV2_api", () => ({
  __esModule: true,
  getMagentoIntegration: jest.fn(),
  magentoApi: { get: jest.fn() },
}));

const mockMagentoQueueAdd = jest.fn();
jest.mock("../../../../magentoV2/queues/magento-sync.queue", () => ({
  __esModule: true,
  MagentoSyncQueue: jest.fn().mockImplementation(() => ({ add: mockMagentoQueueAdd })),
  magentoFetchOrderJobId: (id: string) => `magento-fetch-order-${id}`,
}));

import integrationMappingService from "../../../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../../../../magentoV2/api/magentoV2_api";
import BlingOrderService from "../bling-order.service";

const BLING_ID = "bling-integration";
const MAGENTO_ID = "magento-integration";

describe("BlingOrderService.syncOrderIntegrationMappings", () => {
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlingOrderService({} as any);
    (getMagentoIntegration as jest.Mock).mockResolvedValue({ id: MAGENTO_ID });
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue(null);
  });

  it("pedido do site: mapping Bling + Magento e enfileira fetch-order na MAGENTO_SYNC", async () => {
    await service.syncOrderIntegrationMappings(
      "order-1",
      { id: 26577371207, numeroLoja: "000001271_631" },
      BLING_ID,
    );

    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledWith({
      entity_type: "ORDER",
      internal_id: "order-1",
      external_id: "26577371207",
      integrations_id: BLING_ID,
    });
    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledWith({
      entity_type: "ORDER",
      internal_id: "order-1",
      external_id: "631",
      integrations_id: MAGENTO_ID,
    });
    expect(mockMagentoQueueAdd).toHaveBeenCalledWith(
      { kind: "fetch-order", orderId: "order-1", magentoOrderId: "631" },
      "magento-fetch-order-631",
    );
  });

  it("mapping Magento já existe: não refaz o fetch do cupom", async () => {
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    await service.syncOrderIntegrationMappings(
      "order-1",
      { id: 1, numeroLoja: "000001271_631" },
      BLING_ID,
    );

    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
    expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
  });

  it("pedido fora do site: só o mapping Bling", async () => {
    await service.syncOrderIntegrationMappings("order-1", { id: 1, numeroLoja: "2000012345678" }, BLING_ID);

    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
    expect(getMagentoIntegration).not.toHaveBeenCalled();
    expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
  });

  it("falha na integração não derruba a ingestão", async () => {
    (getMagentoIntegration as jest.Mock).mockRejectedValue(new Error("Magento integration not found"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      service.syncOrderIntegrationMappings("order-1", { id: 1, numeroLoja: "000001271_631" }, BLING_ID),
    ).resolves.toBeUndefined();

    consoleError.mockRestore();
  });
});
