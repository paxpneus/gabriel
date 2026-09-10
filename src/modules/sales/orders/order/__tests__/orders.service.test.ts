// Order (*.model.ts) é auto-mocado globalmente via src/__tests__/setup.ts.

import Order from "../orders.model";
import { OrderService } from "../orders.service";

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
