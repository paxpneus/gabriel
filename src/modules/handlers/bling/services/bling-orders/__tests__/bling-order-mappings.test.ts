// Mapping ORDER da Bling e enfileiramento do fetch-order do cupom (syncOrderIntegrationMappings); o mapping Magento nasce no job.

// Sem Redis/BullMQ reais: BaseQueueService abre Queue/QueueEvents no construtor.
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

jest.mock("../../bling-customers/bling-customer.service", () => ({
  __esModule: true,
  BlingCustomerService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  StoreService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock(
  "../../../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: { createOrUpdateIntegrationMapping: jest.fn(), findOne: jest.fn() },
  }),
);

jest.mock("../../../../magentoV2/api/magentoV2_api", () => ({
  __esModule: true,
  getMagentoIntegration: jest.fn(),
}));

jest.mock("../../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { getWebsitePaxUnitBusinessId: jest.fn() },
}));

jest.mock("../../../../../sales/coupons/order-coupons/order-coupons.service", () => ({
  __esModule: true,
  default: { syncCommissionWithOrder: jest.fn() },
}));

const mockMagentoQueueAdd = jest.fn();
jest.mock("../../../../magentoV2/queues/magento-sync.queue", () => ({
  __esModule: true,
  MagentoSyncQueue: jest.fn().mockImplementation(() => ({ add: mockMagentoQueueAdd })),
  magentoFetchOrderJobId: (id: string) => `magento-fetch-order-${id}`,
}));

import integrationMappingService from "../../../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../../../../magentoV2/api/magentoV2_api";
import unitBusinessService from "../../../../../company/unit-business/unit-business.service";
import BlingOrderService from "../bling-order.service";

const ORDER_ID = "order-1";
const BLING_INTEGRATION_ID = "bling-int";
const MAGENTO_INTEGRATION_ID = "magento-int";
const WEBSITE_UB_ID = "ub-site";

describe("BlingOrderService.syncOrderIntegrationMappings", () => {
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlingOrderService({} as any);
    (getMagentoIntegration as jest.Mock).mockResolvedValue({ id: MAGENTO_INTEGRATION_ID });
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue(null);
    (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockResolvedValue({});
    mockMagentoQueueAdd.mockResolvedValue(undefined);
    (unitBusinessService.getWebsitePaxUnitBusinessId as jest.Mock).mockResolvedValue(WEBSITE_UB_ID);
  });

  const sync = (numeroLoja: unknown, unitBusinessId: string | null = WEBSITE_UB_ID) =>
    service.syncOrderIntegrationMappings(ORDER_ID, { id: 987, numeroLoja }, BLING_INTEGRATION_ID, unitBusinessId);

  it("pedido do site: só o mapping Bling aqui (Magento fica pro job) e enfileira fetch-order", async () => {
    await sync("000001271_631");

    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledWith({
      entity_type: "ORDER",
      internal_id: ORDER_ID,
      external_id: "987",
      integrations_id: BLING_INTEGRATION_ID,
    });
    expect(mockMagentoQueueAdd).toHaveBeenCalledWith(
      { kind: "fetch-order", orderId: ORDER_ID, magentoOrderId: "631" },
      `magento-fetch-order-${ORDER_ID}`,
    );
  });

  it("mapping Magento já existe pra este pedido: não refaz a busca do cupom", async () => {
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue({ id: "map-1", internal_id: ORDER_ID });

    await sync("000001271_631");

    expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
  });

  it("mapping Magento de outro pedido (duplicado/recriado): enfileira e o job decide", async () => {
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue({ id: "map-1", internal_id: "order-0" });

    await sync("000001271_631");

    expect(mockMagentoQueueAdd).toHaveBeenCalled();
  });

  it.each([["outra loja", "ub-woo"], ["sem loja", null]])(
    "numeroLoja no padrão mas fora da loja do site (%s): não busca cupom",
    async (_label, unitBusinessId) => {
      await sync("31002_77051", unitBusinessId);

      expect(getMagentoIntegration).not.toHaveBeenCalled();
      expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
    },
  );

  it("import manual (refetchCoupon) com mapping Magento existente: reenfileira o fetch-order sem recriar mapping", async () => {
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue({ id: "map-1", internal_id: ORDER_ID });

    await service.syncOrderIntegrationMappings(
      ORDER_ID,
      { id: 987, numeroLoja: "000001271_631" },
      BLING_INTEGRATION_ID,
      WEBSITE_UB_ID,
      true,
    );

    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
    expect(mockMagentoQueueAdd).toHaveBeenCalledWith(
      { kind: "fetch-order", orderId: ORDER_ID, magentoOrderId: "631" },
      `magento-fetch-order-${ORDER_ID}`,
    );
  });

  it.each([["MLB123456"], [""], [null], ["1271_"]])(
    "numeroLoja fora do padrão (%p): só o mapping Bling",
    async (numeroLoja) => {
      await sync(numeroLoja);

      expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
      expect(getMagentoIntegration).not.toHaveBeenCalled();
      expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
    },
  );

  it("falha ao enfileirar: sem mapping Magento, o próximo update tenta de novo", async () => {
    mockMagentoQueueAdd.mockRejectedValue(new Error("redis down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sync("000001271_631")).resolves.toBeUndefined();
    expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledTimes(1);
  });

  it("erro não propaga (ingestão do pedido segue)", async () => {
    (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockRejectedValue(
      new Error("db down"),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sync("000001271_631")).resolves.toBeUndefined();
    expect(mockMagentoQueueAdd).not.toHaveBeenCalled();
  });
});
