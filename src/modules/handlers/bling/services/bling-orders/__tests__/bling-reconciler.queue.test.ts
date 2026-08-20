import { Job } from "bullmq";
import { AxiosInstance } from "axios";

// ─── Mocks de infraestrutura (Redis/BullMQ) — BlingReconcilerQueue extends
// BaseQueueService, que cria Queue/QueueEvents reais no construtor mesmo com
// workless:true. ────────────────────────────────────────────────────────────

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
}));

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock("../../../api/bling_api.service", () => ({
  __esModule: true,
  getBlingIntegration: jest.fn(),
}));

jest.mock("../../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../../sales/orders/order/orders.service";
import { getBlingIntegration } from "../../../api/bling_api.service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BlingReconcilerQueue } from "../bling-reconciler.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeBlingApi(): AxiosInstance {
  const get = jest.fn();
  return { get, post: jest.fn(), put: jest.fn(), patch: jest.fn().mockResolvedValue({ data: {} }) } as unknown as AxiosInstance;
}

// GET /canais-venda -> descobre o STORE_ID do Mercado Livre.
function mockChannelResponse(get: jest.Mock, storeId: number | undefined) {
  get.mockImplementation((url: string) => {
    if (url === "/canais-venda") {
      return Promise.resolve({
        data: { data: storeId != null ? [{ id: storeId }] : [] },
      });
    }
    return Promise.resolve({ data: { data: [] } });
  });
}

const STORE_ID = 205955595;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("BlingReconcilerQueue", () => {
  let fakeBlingApi: AxiosInstance;
  let blingOrderNext: { add: jest.Mock };
  let queue: BlingReconcilerQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    fakeBlingApi = makeFakeBlingApi();
    blingOrderNext = { add: jest.fn() };
    queue = new BlingReconcilerQueue(fakeBlingApi, blingOrderNext as any, {
      workless: true,
    });

    (getBlingIntegration as jest.Mock).mockResolvedValue({ id: "integration-1" });
    mockChannelResponse(fakeBlingApi.get as jest.Mock, STORE_ID);
    (ordersService.findAll as jest.Mock).mockResolvedValue([]);
  });

  describe("reconcileOpenOrders (task default/'reconcile-open-orders')", () => {
    it("integration ausente: não busca pedidos na Bling", async () => {
      (getBlingIntegration as jest.Mock).mockResolvedValue(null);

      await queue.process({ data: {} } as Job);

      expect(fakeBlingApi.get).not.toHaveBeenCalled();
    });

    it("canal Mercado Livre não encontrado: não busca pedidos", async () => {
      mockChannelResponse(fakeBlingApi.get as jest.Mock, undefined);

      await queue.process({ data: {} } as Job);

      expect(fakeBlingApi.get).toHaveBeenCalledTimes(1); // só o /canais-venda
    });

    it("reenfileira cada pedido em situação 6 no BlingOrderQueue como order.created", async () => {
      (fakeBlingApi.get as jest.Mock).mockImplementation((url: string) => {
        if (url === "/canais-venda") {
          return Promise.resolve({ data: { data: [{ id: STORE_ID }] } });
        }
        if (url === "/pedidos/vendas") {
          return Promise.resolve({
            data: {
              data: [{ id: 26577371207, numero: 16603, situacao: { id: 6 } }],
            },
          });
        }
        return Promise.resolve({ data: { data: [] } });
      });

      await queue.process({ data: { task: "reconcile-open-orders" } } as Job);

      expect(blingOrderNext.add).toHaveBeenCalledWith(
        {
          event: "order.created",
          action: "created",
          data: { id: 26577371207, numero: 16603, situacao: { id: 6 } },
        },
        "bling-order-created-26577371207",
      );
    });

    it("erro ao reenfileirar um pedido não interrompe os demais e dispara alerta HIGH", async () => {
      (fakeBlingApi.get as jest.Mock).mockImplementation((url: string) => {
        if (url === "/canais-venda") {
          return Promise.resolve({ data: { data: [{ id: STORE_ID }] } });
        }
        if (url === "/pedidos/vendas") {
          return Promise.resolve({
            data: {
              data: [
                { id: 1, numero: 100, situacao: { id: 6 } },
                { id: 2, numero: 200, situacao: { id: 6 } },
              ],
            },
          });
        }
        return Promise.resolve({ data: { data: [] } });
      });
      blingOrderNext.add
        .mockRejectedValueOnce(new Error("falhou"))
        .mockResolvedValueOnce(undefined);

      await queue.process({ data: {} } as Job);

      expect(blingOrderNext.add).toHaveBeenCalledTimes(2);
      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "HIGH" }),
      );
    });
  });

  describe("syncInvoicedOrCollectedOrders (task 'sync-invoiced-or-collected')", () => {
    function mockListAndFullOrder(opts: {
      listedOrders: any[];
      fullOrderData: any;
    }) {
      (fakeBlingApi.get as jest.Mock).mockImplementation((url: string) => {
        if (url === "/canais-venda") {
          return Promise.resolve({ data: { data: [{ id: STORE_ID }] } });
        }
        if (url === "/pedidos/vendas") {
          return Promise.resolve({ data: { data: opts.listedOrders } });
        }
        if (url === `/pedidos/vendas/${opts.listedOrders[0]?.id}`) {
          return Promise.resolve({ data: { data: opts.fullOrderData } });
        }
        return Promise.resolve({ data: { data: {} } });
      });
    }

    it("pedido listado na Bling mas ainda não existe localmente: ignora, sem PATCH", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([]); // não existe local
      mockListAndFullOrder({
        listedOrders: [{ id: 1, numero: 100, situacao: { id: 6 } }],
        fullOrderData: { notaFiscal: { id: 999 } },
      });

      await queue.process({ data: { task: "sync-invoiced-or-collected" } } as Job);

      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });

    it("pedido já tem NF na Bling: PATCH para situação Atendido (9)", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        { number_order_system: "100", collection_date: null },
      ]);
      mockListAndFullOrder({
        listedOrders: [{ id: 1, numero: 100, situacao: { id: 6 } }],
        fullOrderData: { notaFiscal: { id: 999 } },
      });

      await queue.process({ data: { task: "sync-invoiced-or-collected" } } as Job);

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        "/pedidos/vendas/1/situacoes/9",
        { id: 9 },
      );
    });

    it("pedido sem NF mas já com collection_date local: PATCH para 'aguardando NF com coleta' (748748)", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        { number_order_system: "100", collection_date: new Date("2026-08-20") },
      ]);
      mockListAndFullOrder({
        listedOrders: [{ id: 1, numero: 100, situacao: { id: 6 } }],
        fullOrderData: { notaFiscal: undefined },
      });

      await queue.process({ data: { task: "sync-invoiced-or-collected" } } as Job);

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        "/pedidos/vendas/1/situacoes/748748",
        { id: 748748 },
      );
    });

    it("pedido sem NF e sem collection_date: não altera nada na Bling", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        { number_order_system: "100", collection_date: null },
      ]);
      mockListAndFullOrder({
        listedOrders: [{ id: 1, numero: 100, situacao: { id: 6 } }],
        fullOrderData: { notaFiscal: undefined },
      });

      await queue.process({ data: { task: "sync-invoiced-or-collected" } } as Job);

      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });

    it("erro ao sincronizar um pedido não interrompe os demais e dispara alerta MEDIUM", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        { number_order_system: "100", collection_date: null },
        { number_order_system: "200", collection_date: null },
      ]);
      (fakeBlingApi.get as jest.Mock).mockImplementation((url: string) => {
        if (url === "/canais-venda") {
          return Promise.resolve({ data: { data: [{ id: STORE_ID }] } });
        }
        if (url === "/pedidos/vendas") {
          return Promise.resolve({
            data: {
              data: [
                { id: 1, numero: 100, situacao: { id: 6 } },
                { id: 2, numero: 200, situacao: { id: 6 } },
              ],
            },
          });
        }
        if (url === "/pedidos/vendas/1") {
          return Promise.reject(new Error("timeout"));
        }
        if (url === "/pedidos/vendas/2") {
          return Promise.resolve({ data: { data: { notaFiscal: { id: 1 } } } });
        }
        return Promise.resolve({ data: { data: {} } });
      });

      await queue.process({ data: { task: "sync-invoiced-or-collected" } } as Job);

      expect(fakeBlingApi.patch).toHaveBeenCalledTimes(1);
      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "MEDIUM" }),
      );
    });
  });
});
