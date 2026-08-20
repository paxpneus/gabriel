import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../sales/orders/order/orders.types";

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

jest.mock("../../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

jest.mock("../../../../integrations/integrations/integrations.service", () => ({
  __esModule: true,
  default: { getFullIntegration: jest.fn() },
}));

jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../sales/orders/order/orders.service";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import integrationsService from "../../../../integrations/integrations/integrations.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { MLOrderSyncQueue } from "../mercado-livre-sync.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Marca o pedido como elegível (ou não) para os guards isEligibleForSync,
// que revalidam internal_status + source_payload.situacao.id via findById.
function mockEligible(eligible: boolean) {
  (ordersService.findById as jest.Mock).mockResolvedValue(
    eligible
      ? {
          internal_status: "WAITING CHANNEL VALIDATION",
          source_payload: { situacao: { id: "748743" } },
        }
      : { internal_status: "OPEN", source_payload: { situacao: { id: "6" } } },
  );
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-uuid-1",
    id_order_system: "26577371207",
    number_order_channel: "000000461_239",
    internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    collection_date: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    items: [{ sku: "10117005" }],
    ...overrides,
  };
}

function makeFakeBlingApi(): AxiosInstance {
  const get = jest
    .fn()
    .mockResolvedValue({ data: { data: { observacoesInternas: "" } } });
  const put = jest.fn().mockResolvedValue({ data: {} });
  const patch = jest.fn().mockResolvedValue({ data: {} });
  return { get, post: jest.fn(), put, patch } as unknown as AxiosInstance;
}

function makeJob(data: any): Job<any> {
  return { data } as Job<any>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("MLOrderSyncQueue", () => {
  let fakeBlingApi: AxiosInstance;
  let nextFake: {
    getJob: jest.Mock;
    removeJob: jest.Mock;
    addDelayed: jest.Mock;
  };
  let queue: MLOrderSyncQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    fakeBlingApi = makeFakeBlingApi();
    nextFake = {
      getJob: jest.fn().mockResolvedValue(undefined),
      removeJob: jest.fn(),
      addDelayed: jest.fn(),
    };
    queue = new MLOrderSyncQueue(nextFake as any, fakeBlingApi, {
      workless: true,
    });

    (ordersService.update as jest.Mock).mockResolvedValue([1]);
    (integrationsService.getFullIntegration as jest.Mock).mockResolvedValue({
      lock_today_orders: false,
    });
  });

  describe("process — roteamento", () => {
    it("orderSystem já CANCELLED: ignora sem tocar em nada", async () => {
      await queue.process(
        makeJob({
          orderSystem: { ...makeOrder(), internal_status: "CANCELLED" },
          customer: {},
        }),
      );

      expect(ordersService.update).not.toHaveBeenCalled();
      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });

    it("row do Excel sem cache disponível: loga MISS CACHE e não quebra", async () => {
      (redisService.get as jest.Mock).mockResolvedValue(null);

      await expect(
        queue.process(
          makeJob({
            row: {
              order_number: "1",
              sale_date: new Date(),
              collection_date: new Date(),
              sku: "x",
              buyer: "fulano",
            },
          }),
        ),
      ).resolves.toBeUndefined();

      expect(ordersService.update).not.toHaveBeenCalled();
    });
  });

  describe("syncFromWebhook", () => {
    it("elegível e com collection_date já preenchida: agenda NFe direto (scheduleNfe)", async () => {
      mockEligible(true);
      const orderSystem = makeOrder({ collection_date: new Date("2026-08-20") });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748748`,
        { id: 748748 },
      );
      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
      });
    });

    it("elegível e sem collection_date: marca WAITING_CHANNEL_VALIDATION e aguarda próximo scraping", async () => {
      mockEligible(true);
      const orderSystem = makeOrder({ collection_date: null });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
      });
      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });

    it("não elegível (internal_status/situacao já divergentes): ignora sem gravar nada", async () => {
      mockEligible(false);
      const orderSystem = makeOrder();

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(ordersService.update).not.toHaveBeenCalled();
      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });
  });

  describe("applyCollectionDate (via syncFromExcel)", () => {
    function makeCachedOrders(order: any) {
      return [
        {
          ...order,
          date: new Date("2026-08-11"),
          customer: { name: "Daniel Campos Paiva" },
        },
      ];
    }

    function makeRow(overrides: Partial<any> = {}) {
      return {
        order_number: "000000461_239",
        sale_date: new Date("2026-08-11"),
        collection_date: new Date("2026-08-12"),
        sku: "10117005",
        buyer: "Daniel Campos Paiva",
        ...overrides,
      };
    }

    it("pedido já com processo completo: ignora o scraping sem tocar no banco", async () => {
      const order = makeOrder({ internal_status: OrderInternalStatus.EMITTED });
      (redisService.get as jest.Mock).mockResolvedValue(makeCachedOrders(order));

      await queue.process(makeJob({ row: makeRow() }));

      expect(ordersService.update).not.toHaveBeenCalled();
    });

    it("SKU do Excel não bate com nenhum item do pedido: dispara alerta MEDIUM e não atualiza", async () => {
      mockEligible(true);
      const order = makeOrder({ items: [{ sku: "outro-sku" }] });
      (redisService.get as jest.Mock).mockResolvedValue(makeCachedOrders(order));

      await queue.process(makeJob({ row: makeRow() }));

      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "MEDIUM", title: "ML Sync — SKU sem match" }),
      );
      expect(ordersService.update).not.toHaveBeenCalled();
    });

    it("match válido: grava collection_date, anota na Bling e encadeia scheduleNfe (PATCH 748748 + WAITING_FOR_NFE_EMISSION)", async () => {
      mockEligible(true);
      const order = makeOrder();
      (redisService.get as jest.Mock).mockResolvedValue(makeCachedOrders(order));

      await queue.process(makeJob({ row: makeRow() }));

      expect(ordersService.update).toHaveBeenCalledWith(order.id, {
        collection_date: new Date("2026-08-12"),
        number_order_channel: "000000461_239",
      });
      expect(fakeBlingApi.put).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id_order_system}`,
        expect.objectContaining({
          observacoesInternas: expect.stringContaining("ML: 000000461_239"),
        }),
      );
      // scheduleNfe encadeado a partir do mesmo fluxo:
      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id_order_system}/situacoes/748748`,
        { id: 748748 },
      );
      expect(ordersService.update).toHaveBeenCalledWith(order.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
      });
    });
  });

  describe("scheduleNfe (via syncFromWebhook, com collection_date já preenchida)", () => {
    it("pedido já com processo completo: não agenda nada", async () => {
      mockEligible(true);
      const orderSystem = makeOrder({
        internal_status: OrderInternalStatus.EMITTED,
        collection_date: new Date("2026-08-20"),
      });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
      expect(nextFake.addDelayed).not.toHaveBeenCalled();
    });

    it("chegou hoje + coleta hoje/futuro + lock_today_orders ativo + sem job agendado: trava para aceite manual (waiting_acceptance=true), sem PATCH na Bling", async () => {
      mockEligible(true);
      (integrationsService.getFullIntegration as jest.Mock).mockResolvedValue({
        lock_today_orders: true,
      });
      const now = new Date();
      const orderSystem = makeOrder({
        createdAt: now,
        collection_date: now,
      });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
        waiting_acceptance: true,
      });
      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
      expect(nextFake.addDelayed).not.toHaveBeenCalled();
    });

    it("fluxo normal: PATCH 748748 na Bling, grava WAITING_FOR_NFE_EMISSION e agenda job delayed na NFeQueue", async () => {
      mockEligible(true);
      const orderSystem = makeOrder({
        collection_date: new Date("2026-08-25"),
      });

      await queue.process(makeJob({ orderSystem, customer: {} }));

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748748`,
        { id: 748748 },
      );
      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
      });
      expect(nextFake.addDelayed).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: orderSystem.id_order_system,
          collection_date: String(orderSystem.collection_date),
        }),
        `nfe-generation-${orderSystem.id_order_system}`,
        expect.any(Number),
      );
    });
  });
});
