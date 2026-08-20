import { Job } from "bullmq";
import { AxiosInstance } from "axios";

// ─── Mocks de infraestrutura (Redis/BullMQ) — CNPJQueue extends BaseQueueService,
// que cria Queue/QueueEvents reais no construtor mesmo com workless:true. ────

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
  default: { findOne: jest.fn(), update: jest.fn() },
}));

const mockStoreServiceInstance = { findOne: jest.fn() };
jest.mock("../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  StoreService: jest.fn().mockImplementation(() => mockStoreServiceInstance),
}));

jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../sales/orders/order/orders.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { CNPJQueue } from "../cnpj.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFreshOrder(overrides: Partial<any> = {}) {
  return {
    loja: { id: 205955595 },
    situacao: { id: 6 },
    observacoesInternas: "",
    ...overrides,
  };
}

function makeOrderSystem(overrides: Partial<any> = {}) {
  return {
    id: "order-uuid-1",
    id_order_system: "26577371207",
    ...overrides,
  };
}

function makeFakeBlingApi(freshOrder: any): AxiosInstance {
  const get = jest.fn().mockResolvedValue({ data: { data: freshOrder } });
  const put = jest.fn().mockResolvedValue({ data: {} });
  const patch = jest.fn().mockResolvedValue({ data: {} });
  return { get, post: jest.fn(), put, patch } as unknown as AxiosInstance;
}

function makeJob(data: any): Job<any, any, string> {
  return { id: "job-1", data } as Job<any, any, string>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("CNPJQueue", () => {
  let freshOrder: ReturnType<typeof makeFreshOrder>;
  let orderSystem: ReturnType<typeof makeOrderSystem>;
  let fakeBlingApi: AxiosInstance;
  let cnpjServiceFake: { checkCNAE: jest.Mock };
  let nextFake: { add: jest.Mock };
  let queue: CNPJQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    freshOrder = makeFreshOrder();
    orderSystem = makeOrderSystem();
    fakeBlingApi = makeFakeBlingApi(freshOrder);
    cnpjServiceFake = { checkCNAE: jest.fn() };
    nextFake = { add: jest.fn() };

    queue = new CNPJQueue(cnpjServiceFake as any, fakeBlingApi, nextFake as any, {
      workless: true,
    });

    mockStoreServiceInstance.findOne.mockResolvedValue({
      id: "store-1",
      name: "MercadoLivre",
    });
    (ordersService.findOne as jest.Mock).mockResolvedValue(makeOrderSystem());
    (ordersService.update as jest.Mock).mockResolvedValue([1]);
  });

  it("loja diferente de Mercado Livre: ignora sem chamar Bling nem banco", async () => {
    mockStoreServiceInstance.findOne.mockResolvedValue({
      id: "store-2",
      name: "Loja Própria",
    });

    await queue.process(
      makeJob({
        customer: { document: "123", type: "F" },
        cnaes: [],
        orderSystem,
      }),
    );

    expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(nextFake.add).not.toHaveBeenCalled();
  });

  it('situacao.id !== 6 ("Em Aberto"): ignora, pedido já saiu do momento da automação', async () => {
    freshOrder.situacao = { id: 9 };

    await queue.process(
      makeJob({
        customer: { document: "123", type: "F" },
        cnaes: [],
        orderSystem,
      }),
    );

    expect(fakeBlingApi.patch).not.toHaveBeenCalled();
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(nextFake.add).not.toHaveBeenCalled();
  });

  it("documento ausente: markOrderError cancela via syncOrderInternalStatus (internal_status=CANCELLED, nfe_emitted=false)", async () => {
    await queue.process(
      makeJob({
        customer: { document: "", type: "F" },
        cnaes: [],
        orderSystem,
      }),
    );

    expect(fakeBlingApi.put).toHaveBeenCalledWith(
      `/pedidos/vendas/${orderSystem.id_order_system}`,
      expect.objectContaining({
        observacoesInternas: expect.stringContaining(
          "Documento não informado ou inválido",
        ),
      }),
    );
    expect(fakeBlingApi.patch).toHaveBeenCalledWith(
      `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748772`,
      { id: 748772 },
    );
    expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
      internal_status: "CANCELLED",
      nfe_emitted: false,
    });
    expect(nextFake.add).not.toHaveBeenCalled();
  });

  it("cliente CPF: pula validação de CNAE e segue direto para a próxima fila", async () => {
    await queue.process(
      makeJob({
        customer: { document: "54882915634", type: "F" },
        cnaes: [],
        orderSystem,
      }),
    );

    expect(cnpjServiceFake.checkCNAE).not.toHaveBeenCalled();
    expect(fakeBlingApi.patch).toHaveBeenCalledWith(
      `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748743`,
      { id: 748743 },
    );
    expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
      internal_status: "WAITING CHANNEL VALIDATION",
    });
    expect(nextFake.add).toHaveBeenCalledWith(
      { orderSystem, customer: { document: "54882915634", type: "F" } },
      `ml-check-${orderSystem.id}`,
    );
  });

  it("cliente CNPJ com CNAE fora da lista de bloqueio (checkCNAE=false): segue para a próxima fila", async () => {
    cnpjServiceFake.checkCNAE.mockResolvedValue(false);
    const customer = { document: "12345678000199", type: "J" };

    await queue.process(makeJob({ customer, cnaes: ["6201500"], orderSystem }));

    expect(fakeBlingApi.patch).toHaveBeenCalledWith(
      `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748743`,
      { id: 748743 },
    );
    expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
      internal_status: "WAITING CHANNEL VALIDATION",
    });
    expect(nextFake.add).toHaveBeenCalledWith(
      { orderSystem, customer },
      `ml-check-${orderSystem.id}`,
    );
  });

  it("cliente CNPJ com CNAE na lista de bloqueio (checkCNAE=true): cancela via markOrderError", async () => {
    cnpjServiceFake.checkCNAE.mockResolvedValue(true);
    const customer = { document: "12345678000199", type: "J" };

    await queue.process(makeJob({ customer, cnaes: ["6201500"], orderSystem }));

    expect(fakeBlingApi.put).toHaveBeenCalledWith(
      `/pedidos/vendas/${orderSystem.id_order_system}`,
      expect.objectContaining({
        observacoesInternas: expect.stringContaining(
          "CNAE não atendido pela empresa",
        ),
      }),
    );
    expect(ordersService.update).toHaveBeenCalledWith("order-uuid-1", {
      internal_status: "CANCELLED",
      nfe_emitted: false,
    });
    expect(nextFake.add).not.toHaveBeenCalled();
  });

  it("erro do provider de CNAE (mensagem com '[CNPJ]'): dispara alerta HIGH e propaga o erro", async () => {
    cnpjServiceFake.checkCNAE.mockRejectedValue(
      new Error("[CNPJ] todos os providers falharam"),
    );
    const customer = { document: "12345678000199", type: "J" };

    await expect(
      queue.process(makeJob({ customer, cnaes: ["6201500"], orderSystem })),
    ).rejects.toThrow("[CNPJ] todos os providers falharam");

    expect(alertService.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "HIGH",
        title: "CNPJ API — todos os providers falharam",
      }),
    );
    expect(ordersService.update).not.toHaveBeenCalled();
  });

  it("erro genérico ao validar CNAE: propaga sem disparar alerta", async () => {
    cnpjServiceFake.checkCNAE.mockRejectedValue(new Error("timeout de rede"));
    const customer = { document: "12345678000199", type: "J" };

    await expect(
      queue.process(makeJob({ customer, cnaes: ["6201500"], orderSystem })),
    ).rejects.toThrow("timeout de rede");

    expect(alertService.sendAlert).not.toHaveBeenCalled();
  });
});
