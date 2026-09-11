// Order/Store (*.model.ts) são auto-mocados globalmente via src/__tests__/setup.ts.

import Order from "../orders.model";
import Store from "../../../stores/stores.model";
import { OrderService } from "../orders.service";
import orderRepository from "../orders.repository";

describe("OrderService.releaseWaitingAcceptanceForToday", () => {
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService();
  });

  it("acha pedidos travados: retorna a lista completa e zera waiting_acceptance no banco", async () => {
    const releasedOrders = [
      { id: "o1", id_order_system: "26577371207", waiting_acceptance: true },
      { id: "o2", id_order_system: "26577371208", waiting_acceptance: true },
    ];
    (Order.findAll as jest.Mock).mockResolvedValue(releasedOrders);
    (Order.update as jest.Mock).mockResolvedValue([2]);

    const result = await service.releaseWaitingAcceptanceForToday();

    expect(result).toEqual(releasedOrders);
    expect(Order.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          waiting_acceptance: true,
          internal_status: "WAITING FOR NFE EMISSION",
        }),
      }),
    );
    // A seleção acontece ANTES do update, com o mesmo where — senão a lista
    // retornada não corresponderia aos pedidos de fato afetados.
    expect(Order.update).toHaveBeenCalledWith(
      { waiting_acceptance: false },
      expect.objectContaining({
        where: expect.objectContaining({
          waiting_acceptance: true,
          internal_status: "WAITING FOR NFE EMISSION",
        }),
      }),
    );
  });

  it("nenhum pedido travado: retorna lista vazia sem chamar update", async () => {
    (Order.findAll as jest.Mock).mockResolvedValue([]);

    const result = await service.releaseWaitingAcceptanceForToday();

    expect(result).toEqual([]);
    expect(Order.update).not.toHaveBeenCalled();
  });
});

describe("OrderService — resumo de status", () => {
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService();
    // Contagens/agrupamentos são escopados à loja Mercado Livre — sem
    // resolver esse id primeiro, tudo retorna 0/[] (guard em
    // OrderRepository.resolveMercadoLivreStoreId).
    (Store.findOne as jest.Mock).mockResolvedValue({ id: "store-ml-1" });
  });

  it("getOrdersStatusSummary: retorna { quantity } pra cada uma das 4 categorias", async () => {
    // Mocka os métodos do repositório diretamente (não Order.count em
    // sequência) — as 4 chamadas rodam em paralelo (Promise.all) e têm
    // profundidade de await diferente entre si (resolução da loja Mercado
    // Livre), então a ordem real de resolução de Order.count não é
    // garantida bater com a ordem literal do Promise.all.
    jest.spyOn(orderRepository, "countHumanVerification").mockResolvedValue(3);
    jest.spyOn(orderRepository, "countShipTodayPending").mockResolvedValue(7);
    jest.spyOn(orderRepository, "countShipToDefine").mockResolvedValue(2);
    jest.spyOn(orderRepository, "countShipToFuture").mockResolvedValue(11);

    const result = await service.getOrdersStatusSummary("ub-1");

    expect(result).toEqual({
      human_verification: { quantity: 3 },
      ship_today_pending: { quantity: 7 },
      ship_to_define: { quantity: 2 },
      ship_to_future: { quantity: 11 },
    });
  });

  it("getShipTodayPendingDetail: lista os pedidos com cliente e nota vinculada (se tiver)", async () => {
    const makeRow = (data: any) => ({ get: () => data });
    (Order.findAll as jest.Mock).mockResolvedValue([
      makeRow({
        number_order_system: "16603",
        date: new Date("2026-09-10"),
        collection_date: new Date("2026-09-11"),
        customer: { name: "DANIEL CAMPOS PAIVA" },
        invoice: { number_system: "017435", emitted_at: new Date("2026-09-11T08:40:45Z") },
      }),
      makeRow({
        number_order_system: "16604",
        date: new Date("2026-09-10"),
        collection_date: new Date("2026-09-11"),
        customer: null,
        invoice: null,
      }),
    ]);

    const result = await service.getShipTodayPendingDetail("ub-1");

    expect(result).toEqual([
      {
        number_order_system: "16603",
        customer_name: "DANIEL CAMPOS PAIVA",
        sale_date: new Date("2026-09-10"),
        collection_date: new Date("2026-09-11"),
        invoice_number: "017435",
        invoice_emitted_at: new Date("2026-09-11T08:40:45Z"),
      },
      {
        number_order_system: "16604",
        customer_name: null,
        sale_date: new Date("2026-09-10"),
        collection_date: new Date("2026-09-11"),
        invoice_number: null,
        invoice_emitted_at: null,
      },
    ]);
  });

  it("getShipToDefineDetail: lista os pedidos pendentes sem collection_date, status igual à listagem padrão (status_snapshot > internal_status)", async () => {
    const makeRow = (data: any) => ({ get: () => data });
    (Order.findAll as jest.Mock).mockResolvedValue([
      makeRow({
        id_order_system: "26577371207",
        internal_status: "OPEN",
        date: new Date("2026-09-10"),
        customer: { name: "DANIEL CAMPOS PAIVA" },
        salesSnapshot: { status_snapshot: "PENDENTE" },
      }),
      makeRow({
        id_order_system: "26577371208",
        internal_status: "WAITING CHANNEL VALIDATION",
        date: new Date("2026-09-11"),
        customer: null,
        salesSnapshot: null,
      }),
    ]);

    const result = await service.getShipToDefineDetail();

    expect(result).toEqual([
      {
        id_order_system: "26577371207",
        customer_name: "DANIEL CAMPOS PAIVA",
        status: "PENDENTE", // veio do status_snapshot, não do internal_status
        sale_date: new Date("2026-09-10"),
      },
      {
        id_order_system: "26577371208",
        customer_name: null,
        status: "WAITING CHANNEL VALIDATION", // sem snapshot, cai pro internal_status
        sale_date: new Date("2026-09-11"),
      },
    ]);
  });

  it("getHumanVerificationDetail: agrupa por reason_cancelled, usando UNSET quando nulo", async () => {
    (Order.findAll as jest.Mock).mockResolvedValue([
      { reason_cancelled: "CNAE_BLOCKED", quantity: "5" },
      { reason_cancelled: null, quantity: "1" },
    ]);

    const result = await service.getHumanVerificationDetail();

    expect(result).toEqual({ CNAE_BLOCKED: 5, UNSET: 1 });
  });

  it("getShipToFutureDetail: agrupa por data (YYYY-MM-DD)", async () => {
    (Order.findAll as jest.Mock).mockResolvedValue([
      { date_bucket: "2026-09-19", quantity: "20" },
      { date_bucket: "2026-09-20", quantity: "30" },
    ]);

    const result = await service.getShipToFutureDetail();

    expect(result).toEqual({ "2026-09-19": 20, "2026-09-20": 30 });
  });
});
