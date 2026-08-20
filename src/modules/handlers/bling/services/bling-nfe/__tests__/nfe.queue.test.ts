import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../../sales/orders/order/orders.types";

// ─── Mocks de infraestrutura (Redis/BullMQ) — NFeQueue extends BaseQueueService,
// que cria Queue/QueueEvents reais no construtor mesmo com workless:true.
// Nenhum teste desta suite deve abrir conexão real com Redis. ────────────────

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
  default: { findOne: jest.fn(), update: jest.fn() },
}));

const mockStoreServiceInstance = { findOne: jest.fn() };
jest.mock("../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  StoreService: jest.fn().mockImplementation(() => mockStoreServiceInstance),
}));

jest.mock("../../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../../sales/orders/order/orders.service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { NFeQueue } from "../nfe.queue";
import { NFeValidationService } from "../nfe-validation.service";
import { NFeJobData } from "../nfe.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS = {
  NFE_AGENDADA: 748748,
};

// Payload completo o bastante para passar em NFeValidationService.validate().
function makeValidOrder(overrides: Partial<any> = {}) {
  return {
    id: 26577371207,
    loja: { id: 205955595 },
    situacao: { id: STATUS.NFE_AGENDADA },
    contato: {
      nome: "DANIEL CAMPOS PAIVA",
      tipoPessoa: "F",
      numeroDocumento: "548.829.156-34",
    },
    transporte: {
      etiqueta: {
        nome: "DANIEL CAMPOS PAIVA",
        endereco: "Avenida Canadá",
        numero: "323",
        municipio: "Nova Lima",
        uf: "MG",
        cep: "34007654",
      },
    },
    itens: [
      {
        codigo: "10117005",
        descricao: "Pneu 265/60R18 110H",
        produto: { id: 16651094648 },
        quantidade: 2,
        valor: 1043.33,
      },
    ],
    parcelas: [{ formaPagamento: { id: 9521653 }, valor: 1933.57 }],
    intermediador: { cnpj: "12345678000199", nomeUsuario: "loja_ml" },
    totalProdutos: 2086.66,
    total: 1933.57,
    observacoesInternas: "",
    ...overrides,
  };
}

function makeFakeBlingApi(order: any) {
  const get = jest.fn().mockResolvedValue({ data: { data: order } });
  const post = jest.fn().mockResolvedValue({ data: {} });
  const put = jest.fn().mockResolvedValue({ data: {} });
  const patch = jest.fn().mockResolvedValue({ data: {} });
  return { get, post, put, patch } as unknown as AxiosInstance;
}

function makeJob(data: NFeJobData): Job<NFeJobData> {
  return { data } as Job<NFeJobData>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("NFeQueue", () => {
  let order: ReturnType<typeof makeValidOrder>;
  let fakeBlingApi: AxiosInstance;
  let queue: NFeQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    order = makeValidOrder();
    fakeBlingApi = makeFakeBlingApi(order);
    queue = new NFeQueue(new NFeValidationService(), fakeBlingApi, {
      workless: true,
    });

    mockStoreServiceInstance.findOne.mockResolvedValue({
      id: "store-1",
      name: "MercadoLivre",
    });
    (ordersService.findOne as jest.Mock).mockResolvedValue({
      id: "order-uuid-1",
    });
    (ordersService.update as jest.Mock).mockResolvedValue([1]);
  });

  describe("process — situação NFE_AGENDADA", () => {
    it("emite a NFe (POST sem corpo) e grava internal_status=EMITTED, nfe_emitted=true", async () => {
      await queue.process(
        makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
      );

      expect(fakeBlingApi.post).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}/gerar-nfe`,
      );
      expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
        nfe_emitted: true,
        internal_status: OrderInternalStatus.EMITTED,
      });
    });

    it("não emite NFe se a loja não for Mercado Livre", async () => {
      mockStoreServiceInstance.findOne.mockResolvedValue({
        id: "store-2",
        name: "Loja Própria",
      });

      await queue.process(
        makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
      );

      expect(fakeBlingApi.post).not.toHaveBeenCalled();
      expect(ordersService.update).not.toHaveBeenCalled();
    });

    it("campos obrigatórios ausentes cancela o pedido sem emitir", async () => {
      order.intermediador = { cnpj: "", nomeUsuario: "" };

      await queue.process(
        makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
      );

      expect(fakeBlingApi.post).not.toHaveBeenCalled();
      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}/situacoes/748772`,
        { id: 748772 },
      );
      expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
        internal_status: OrderInternalStatus.CANCELLED,
      });
    });

    it("falha na emissão por falta de estoque (code 74) cancela sem propagar o erro", async () => {
      (fakeBlingApi.post as jest.Mock).mockRejectedValue({
        response: { data: { error: { fields: [{ code: 74 }] } } },
      });

      await expect(
        queue.process(
          makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
        ),
      ).resolves.toBeUndefined();

      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}/situacoes/748772`,
        { id: 748772 },
      );
      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "HIGH", title: "NFe — Sem estoque" }),
      );
    });

    it("outros erros de emissão propagam (para retry do BullMQ)", async () => {
      (fakeBlingApi.post as jest.Mock).mockRejectedValue({
        response: { data: { error: { fields: [] } } },
      });

      await expect(
        queue.process(
          makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
        ),
      ).rejects.toBeDefined();

      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });
  });

  describe("process — situação diferente de NFE_AGENDADA", () => {
    it("situacao mudou para um status completo (834029) antes da emissão: sincroniza sem cancelar", async () => {
      order.situacao = { id: 834029 };

      await queue.process(
        makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
      );

      expect(fakeBlingApi.post).not.toHaveBeenCalled();
      expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
        nfe_emitted: true,
        internal_status: "SENT_TO_TRANSPORTER",
      });
      // markOrderCancelled não deve rodar — nenhum PATCH de "verificação humana".
      expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    });

    it("situacao não tratada (não completa, não cancelada) cai em markOrderCancelled", async () => {
      order.situacao = { id: 999999 }; // mapeia para UNKNOWN

      await queue.process(
        makeJob({ order_id: order.id, collection_date: "2026-08-11" }),
      );

      expect(fakeBlingApi.put).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}`,
        expect.objectContaining({
          observacoesInternas: expect.stringContaining(
            "Pedido não estava no status NFE Agendada ao tentar gerar NFe",
          ),
        }),
      );
      expect(fakeBlingApi.patch).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}/situacoes/748772`,
        { id: 748772 },
      );
      expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
        internal_status: OrderInternalStatus.CANCELLED,
      });
    });
  });

  describe("onFailed", () => {
    it("timeout de lock compartilhado NÃO cancela o pedido", () => {
      const job = makeJob({ order_id: order.id, collection_date: "2026-08-11" });

      (queue as any).onFailed(
        job,
        new Error("Timeout aguardando lock compartilhado"),
      );

      expect(fakeBlingApi.put).not.toHaveBeenCalled();
      expect(alertService.sendAlert).not.toHaveBeenCalled();
    });

    it("outras falhas cancelam o pedido e enviam a mensagem legível de EMISSION_FAILED à Bling — achado N1", async () => {
      // markOrderCancelled é fire-and-forget dentro de onFailed e tem dois
      // delays reais (1s + 3s) antes do PUT/PATCH — usa fake timers pra não
      // deixar o teste (e o processo) pendurado esperando timers reais.
      jest.useFakeTimers();
      const job = makeJob({ order_id: order.id, collection_date: "2026-08-11" });

      (queue as any).onFailed(job, new Error("Erro genérico de emissão"));

      await jest.advanceTimersByTimeAsync(5000);
      jest.useRealTimers();

      expect(fakeBlingApi.put).toHaveBeenCalledWith(
        `/pedidos/vendas/${order.id}`,
        expect.objectContaining({
          observacoesInternas: expect.stringContaining("Falha ao gerar NFe na Bling"),
        }),
      );
      expect(alertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "CRITICAL" }),
      );
    });
  });
});
