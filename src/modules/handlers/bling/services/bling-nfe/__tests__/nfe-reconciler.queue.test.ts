import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../../sales/orders/order/orders.types";

// ─── Mocks de infraestrutura (Redis/BullMQ) — ReconcilerQueue extends
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
  default: { findAll: jest.fn(), getFullOrdersByQuery: jest.fn(), update: jest.fn() },
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
import { ReconcilerQueue } from "../nfe-reconciler.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeBlingApi(): AxiosInstance {
  const get = jest.fn();
  const put = jest.fn().mockResolvedValue({ data: {} });
  const patch = jest.fn().mockResolvedValue({ data: {} });
  return { get, post: jest.fn(), put, patch } as unknown as AxiosInstance;
}

function makeQueue(blingApi: AxiosInstance, cnpjNext: any, nfeNext: any) {
  return new ReconcilerQueue(cnpjNext, nfeNext, blingApi, { workless: true });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("ReconcilerQueue", () => {
  let fakeBlingApi: AxiosInstance;
  let cnpjNext: { add: jest.Mock; getJob: jest.Mock };
  let nfeNext: { addDelayed: jest.Mock; getJob: jest.Mock };
  let queue: ReconcilerQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    fakeBlingApi = makeFakeBlingApi();
    cnpjNext = { add: jest.fn(), getJob: jest.fn().mockResolvedValue(undefined) };
    nfeNext = { addDelayed: jest.fn(), getJob: jest.fn().mockResolvedValue(undefined) };
    queue = makeQueue(fakeBlingApi, cnpjNext, nfeNext);

    (getBlingIntegration as jest.Mock).mockResolvedValue({
      id: "integration-1",
      cnaes: ["6201500"],
      lock_today_orders: false,
    });
    (ordersService.findAll as jest.Mock).mockResolvedValue([]);
    (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([]);
    (ordersService.update as jest.Mock).mockResolvedValue([1]);
  });

  describe("reconcileWaitingNfe", () => {
    it("pedido sem collection_date: pula sem recriar job", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        { id: "o1", id_order_system: "1001", collection_date: null },
      ]);

      await (queue as any).reconcileWaitingNfe();

      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
    });

    it("job já existe no Redis: não recria", async () => {
      nfeNext.getJob.mockResolvedValue({ id: "existing-job" });
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        {
          id: "o1",
          id_order_system: "1001",
          collection_date: new Date("2026-08-20"),
        },
      ]);

      await (queue as any).reconcileWaitingNfe();

      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
    });

    it("job ausente: recria com order_id e collection_date corretos", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        {
          id: "o1",
          id_order_system: "1001",
          collection_date: new Date("2026-08-20"),
        },
      ]);

      await (queue as any).reconcileWaitingNfe();

      expect(nfeNext.addDelayed).toHaveBeenCalledWith(
        { order_id: "1001", collection_date: String(new Date("2026-08-20")) },
        "nfe-generation-1001",
        expect.any(Number),
      );
    });
  });

  describe("reconcileOpenOrders", () => {
    it("integration ausente: não busca pedidos", async () => {
      (getBlingIntegration as jest.Mock).mockResolvedValue(null);

      await (queue as any).reconcileOpenOrders();

      expect(ordersService.getFullOrdersByQuery).not.toHaveBeenCalled();
    });

    it("job já existe no Redis: não reenfileira", async () => {
      cnpjNext.getJob.mockResolvedValue({ id: "existing-job" });
      (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([
        { id: "o1", id_order_system: "1001", customer: {}, number_order_system: "1001" },
      ]);

      await (queue as any).reconcileOpenOrders();

      expect(cnpjNext.add).not.toHaveBeenCalled();
    });

    it("job ausente: reenfileira no CNPJQueue com customer/cnaes/orderSystem", async () => {
      const order = {
        id: "o1",
        id_order_system: "1001",
        customer: { id: "c1" },
        number_order_system: "1001",
      };
      (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([order]);

      await (queue as any).reconcileOpenOrders();

      expect(cnpjNext.add).toHaveBeenCalledWith(
        { customer: order.customer, cnaes: ["6201500"], orderSystem: order },
        "document-check-1001",
      );
    });

    it("erro em um pedido não interrompe os demais", async () => {
      const orderA = { id: "a", id_order_system: "1", customer: {}, number_order_system: "1" };
      const orderB = { id: "b", id_order_system: "2", customer: {}, number_order_system: "2" };
      (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([orderA, orderB]);
      cnpjNext.add
        .mockRejectedValueOnce(new Error("falhou"))
        .mockResolvedValueOnce(undefined);

      await (queue as any).reconcileOpenOrders();

      expect(cnpjNext.add).toHaveBeenCalledTimes(2);
    });
  });

  describe("reconcileStuckOrders", () => {
    function makeStuckOrder(overrides: Partial<any> = {}) {
      return { id: "o1", id_order_system: "1001", ...overrides };
    }

    it("situação já mudou pra um status completo (834029): grava internal_status e nfe_emitted=true", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([makeStuckOrder()]);
      (fakeBlingApi.get as jest.Mock).mockResolvedValue({
        data: { data: { situacao: { id: 834029 } } },
      });

      await (queue as any).reconcileStuckOrders();

      expect(ordersService.update).toHaveBeenCalledWith("o1", {
        internal_status: "SENT_TO_TRANSPORTER",
        nfe_emitted: true,
      });
      expect(fakeBlingApi.put).not.toHaveBeenCalled();
    });

    it("situação já mudou pra CANCELLED (12): grava internal_status e nfe_emitted=false", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([makeStuckOrder()]);
      (fakeBlingApi.get as jest.Mock).mockResolvedValue({
        data: { data: { situacao: { id: 12 } } },
      });

      await (queue as any).reconcileStuckOrders();

      expect(ordersService.update).toHaveBeenCalledWith("o1", {
        internal_status: OrderInternalStatus.CANCELLED,
        nfe_emitted: false,
      });
    });

    it("situação já mudou pra um status intermediário (6=OPEN): grava só internal_status, sem nfe_emitted", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([makeStuckOrder()]);
      (fakeBlingApi.get as jest.Mock).mockResolvedValue({
        data: { data: { situacao: { id: 6 } } },
      });

      await (queue as any).reconcileStuckOrders();

      expect(ordersService.update).toHaveBeenCalledWith("o1", {
        internal_status: OrderInternalStatus.OPEN,
      });
      const call = (ordersService.update as jest.Mock).mock.calls[0][1];
      expect(call).not.toHaveProperty("nfe_emitted");
    });

    it('ainda travado (748743): marca "verificação humana" na Bling e grava nfe_emitted=false — achado R1', async () => {
      // reconcileStuckOrders tem delays reais (1s + 3s) nesse branch antes do
      // PUT/PATCH — usa fake timers pra não deixar o teste pendurado.
      jest.useFakeTimers();
      (ordersService.findAll as jest.Mock).mockResolvedValue([makeStuckOrder()]);
      (fakeBlingApi.get as jest.Mock).mockResolvedValue({
        data: { data: { situacao: { id: 748743 }, observacoesInternas: "" } },
      });

      const pending = (queue as any).reconcileStuckOrders();
      await jest.advanceTimersByTimeAsync(5000);
      await pending;
      jest.useRealTimers();

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        "/pedidos/vendas/1001/situacoes/748772",
        { id: 748772 },
      );
      // 748772 sempre mapeia para CANCELLED — igual ao branch acima (situação
      // já mudou), este branch também deve gravar nfe_emitted=false.
      expect(ordersService.update).toHaveBeenCalledWith("o1", {
        internal_status: OrderInternalStatus.CANCELLED,
        nfe_emitted: false,
      });
    });

    it("erro em um pedido não interrompe os demais e ainda dispara o alerta final", async () => {
      (ordersService.findAll as jest.Mock).mockResolvedValue([
        makeStuckOrder({ id: "a", id_order_system: "1" }),
        makeStuckOrder({ id: "b", id_order_system: "2" }),
      ]);
      (fakeBlingApi.get as jest.Mock)
        .mockRejectedValueOnce(new Error("falha de rede"))
        .mockResolvedValueOnce({ data: { data: { situacao: { id: 9 } } } });

      await (queue as any).reconcileStuckOrders();

      expect(ordersService.update).toHaveBeenCalledTimes(1);
      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "MEDIUM" }),
      );
    });
  });

  describe("process — dispatcher", () => {
    it("uma sub-rotina falhando dispara alerta CRITICAL com o nome certo, sem derrubar as outras", async () => {
      jest
        .spyOn(queue as any, "reconcileWaitingNfe")
        .mockRejectedValue(new Error("boom"));
      jest.spyOn(queue as any, "reconcileOpenOrders").mockResolvedValue(undefined);
      jest.spyOn(queue as any, "reconcileStuckOrders").mockResolvedValue(undefined);

      await queue.process({} as Job);

      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: "CRITICAL",
          title: "Reconciler — reconcileWaitingNfe falhou",
        }),
      );
    });
  });
});
