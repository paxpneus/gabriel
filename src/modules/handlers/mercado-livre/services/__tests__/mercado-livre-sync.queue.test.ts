import { Job } from "bullmq";
import { OrderInternalStatus, MarketPlaceLabelStatus } from "../../../../sales/orders/order/orders.types";

// ─── Mocks de infraestrutura (Redis/BullMQ) — MLOrderSyncQueue extends
// BaseQueueService, que cria Queue/QueueEvents reais no construtor mesmo com
// workless:true. ────────────────────────────────────────────────────────────

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
}));

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), update: jest.fn() },
}));

jest.mock("../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

// redisConnection abaixo é o que withOrderLock (base-queue-service.ts) usa
// pro lock por pedido — precisa resolver "OK" no set pra não ficar girando
// em loop de retry até estourar o timeout do teste.
jest.mock("../../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
  redisConnection: {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
  },
}));

jest.mock(
  "../../../bling/services/bling-nfe/collection-date/collection-date-scheduler.service",
  () => ({
    __esModule: true,
    isEligibleForSync: jest.fn(),
    // Só usado como tipo pelo MLOrderSyncQueue — nunca instanciado
    // diretamente aqui (o teste injeta um fake via construtor).
    CollectionDateSchedulerService: jest.fn(),
  }),
);

jest.mock("../../../marketplace/services/marketplace-order-shipment.service", () => ({
  __esModule: true,
  getMarketplaceCollectionAndLabelStatusWithRetry: jest.fn(),
}));

jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../sales/orders/order/orders.service";
import storeService from "../../../../sales/stores/stores.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { isEligibleForSync } from "../../../bling/services/bling-nfe/collection-date/collection-date-scheduler.service";
import { getMarketplaceCollectionAndLabelStatusWithRetry } from "../../../marketplace/services/marketplace-order-shipment.service";
import { MLOrderSyncQueue } from "../mercado-livre-sync.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Marca o pedido como elegível (ou não) para os guards isEligibleForSync,
// que revalidam internal_status + actual_situation via findById.
function mockEligible(eligible: boolean) {
  (ordersService.findById as jest.Mock).mockResolvedValue(
    eligible
      ? {
          internal_status: "WAITING CHANNEL VALIDATION",
          actual_situation: "748743",
        }
      : { internal_status: "OPEN", actual_situation: "6" },
  );
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-uuid-1",
    id_order_system: "26577371207",
    number_order_channel: "000000461_239",
    internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    collection_date: null as Date | null,
    store_id: "store-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    items: [{ sku: "10117005" }],
    ...overrides,
  };
}

function makeJob(data: any): Job<any> {
  return { data } as Job<any>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("MLOrderSyncQueue", () => {
  let mockCollectionDateScheduler: {
    syncCollectionDateLocked: jest.Mock;
    finalizeNfeScheduling: jest.Mock;
  };
  let queue: MLOrderSyncQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCollectionDateScheduler = {
      syncCollectionDateLocked: jest.fn().mockResolvedValue(undefined),
      finalizeNfeScheduling: jest.fn().mockResolvedValue(undefined),
    };
    queue = new MLOrderSyncQueue(mockCollectionDateScheduler as any, { workless: true });

    (ordersService.update as jest.Mock).mockResolvedValue([1]);
    (isEligibleForSync as jest.Mock).mockResolvedValue(true);
    (storeService.findById as jest.Mock).mockResolvedValue({ id: "store-1", name: "MercadoLivre" });
    (getMarketplaceCollectionAndLabelStatusWithRetry as jest.Mock).mockResolvedValue({
      collectionDate: new Date("2026-08-20"),
      labelStatus: MarketPlaceLabelStatus.READY_TO_PRINT,
    });
  });

  describe("process — roteamento", () => {
    it("orderSystem já CANCELLED: ignora sem consultar elegibilidade nem o marketplace", async () => {
      await queue.process(
        makeJob({
          orderSystem: { ...makeOrder(), internal_status: "CANCELLED" },
          customer: {},
        }),
      );

      expect(isEligibleForSync).not.toHaveBeenCalled();
      expect(ordersService.update).not.toHaveBeenCalled();
    });

    it("orderSystem ausente: loga e não quebra", async () => {
      await expect(
        queue.process(makeJob({ orderSystem: null, customer: {} })),
      ).resolves.toBeUndefined();

      expect(isEligibleForSync).not.toHaveBeenCalled();
    });
  });

  describe("syncFromWebhookLocked", () => {
    it("não elegível (internal_status/situacao já divergentes): ignora sem consultar o marketplace", async () => {
      (isEligibleForSync as jest.Mock).mockResolvedValue(false);
      const orderSystem = makeOrder();

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(getMarketplaceCollectionAndLabelStatusWithRetry).not.toHaveBeenCalled();
      expect(ordersService.update).not.toHaveBeenCalled();
    });

    it("pedido sem store_id: alerta LOW e não consulta o marketplace", async () => {
      const orderSystem = makeOrder({ store_id: null });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "LOW", title: "ML Sync — pedido sem store" }),
      );
      expect(getMarketplaceCollectionAndLabelStatusWithRetry).not.toHaveBeenCalled();
    });

    it("marketplace responde com sucesso e collectionDate: grava label status e aciona o CollectionDateScheduler", async () => {
      const orderSystem = makeOrder();

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(storeService.findById).toHaveBeenCalledWith("store-1", { attributes: ["name"] });
      expect(getMarketplaceCollectionAndLabelStatusWithRetry).toHaveBeenCalledWith(
        "MercadoLivre",
        orderSystem.number_order_channel,
      );
      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        market_place_label_status: MarketPlaceLabelStatus.READY_TO_PRINT,
      });
      expect(mockCollectionDateScheduler.syncCollectionDateLocked).toHaveBeenCalledWith(
        orderSystem.id_order_system,
        new Date("2026-08-20"),
        orderSystem,
      );
    });

    it("marketplace responde com sucesso mas sem collectionDate ainda, sem fallback local: grava label status, não lança erro, não agenda nada", async () => {
      (getMarketplaceCollectionAndLabelStatusWithRetry as jest.Mock).mockResolvedValue({
        collectionDate: null,
        labelStatus: MarketPlaceLabelStatus.WAITING_MARKETPLACE_PROCESS_NFE,
      });
      const orderSystem = makeOrder({ collection_date: null });

      await expect(
        queue.process(makeJob({ orderSystem, customer: {} })),
      ).resolves.toBeUndefined();

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        market_place_label_status: MarketPlaceLabelStatus.WAITING_MARKETPLACE_PROCESS_NFE,
      });
      expect(mockCollectionDateScheduler.syncCollectionDateLocked).not.toHaveBeenCalled();
    });

    it("retry esgotado (marketplace fora do ar) mas há collection_date local: usa o valor local como fallback, label status não é tocado", async () => {
      (getMarketplaceCollectionAndLabelStatusWithRetry as jest.Mock).mockResolvedValue(null);
      const orderSystem = makeOrder({ collection_date: new Date("2026-08-18") });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(ordersService.update).not.toHaveBeenCalled();
      expect(mockCollectionDateScheduler.syncCollectionDateLocked).toHaveBeenCalledWith(
        orderSystem.id_order_system,
        new Date(orderSystem.collection_date!),
        orderSystem,
      );
    });

    it("retry esgotado e sem nenhuma collection_date de fallback: lança erro (job falha e será retentado pelo BullMQ)", async () => {
      (getMarketplaceCollectionAndLabelStatusWithRetry as jest.Mock).mockResolvedValue(null);
      const orderSystem = makeOrder({ collection_date: null });

      await expect(
        queue.process(makeJob({ orderSystem, customer: {} })),
      ).rejects.toThrow();

      expect(mockCollectionDateScheduler.syncCollectionDateLocked).not.toHaveBeenCalled();
    });
  });

  describe("resumeAfterAcceptance", () => {
    function makeReleasedOrder(overrides: Partial<any> = {}) {
      return makeOrder({
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
        waiting_acceptance: false,
        collection_date: new Date("2026-08-25"),
        ...overrides,
      });
    }

    it("estado esperado (WAITING_FOR_NFE_EMISSION, waiting_acceptance=false): delega a finalização pro CollectionDateScheduler", async () => {
      const order = makeReleasedOrder();
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.resumeAfterAcceptance(order.id);

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).toHaveBeenCalledWith(
        order.id_order_system,
        new Date(order.collection_date!),
        order,
      );
    });

    it("pedido não encontrado: não faz nada", async () => {
      (ordersService.findById as jest.Mock).mockResolvedValue(null);

      await queue.resumeAfterAcceptance("missing-id");

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).not.toHaveBeenCalled();
    });

    it("sem id_order_system: não faz nada", async () => {
      const order = makeReleasedOrder({ id_order_system: undefined });
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.resumeAfterAcceptance(order.id);

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).not.toHaveBeenCalled();
    });

    it("ainda waiting_acceptance=true (liberação não confirmada de verdade): ignora sem agendar", async () => {
      const order = makeReleasedOrder({ waiting_acceptance: true });
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.resumeAfterAcceptance(order.id);

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).not.toHaveBeenCalled();
    });

    it("internal_status divergente (não é mais WAITING_FOR_NFE_EMISSION): ignora sem agendar", async () => {
      const order = makeReleasedOrder({ internal_status: OrderInternalStatus.EMITTED });
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.resumeAfterAcceptance(order.id);

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).not.toHaveBeenCalled();
    });

    it("sem collection_date: não agenda (não tem como calcular o delay)", async () => {
      const order = makeReleasedOrder({ collection_date: null });
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.resumeAfterAcceptance(order.id);

      expect(mockCollectionDateScheduler.finalizeNfeScheduling).not.toHaveBeenCalled();
    });

    it("process() roteia { resumeOrderId } pra resumeAfterAcceptance", async () => {
      const order = makeReleasedOrder();
      (ordersService.findById as jest.Mock).mockResolvedValue(order);

      await queue.process(makeJob({ resumeOrderId: order.id }));

      expect(ordersService.findById).toHaveBeenCalledWith(order.id);
      expect(mockCollectionDateScheduler.finalizeNfeScheduling).toHaveBeenCalledWith(
        order.id_order_system,
        new Date(order.collection_date!),
        order,
      );
    });
  });
});
