import { blingApi } from "../../api/bling_api.service";
import { blingPost } from "../bling/helpers/get-with-sleep";
import ordersService from "../../../../sales/orders/order/orders.service";
import {
  OrderInternalStatus,
  TERMINAL_ORDER_INTERNAL_STATUSES,
} from "../../../../sales/orders/order/orders.types";

// Geração de NFe direta, fora do pipeline automático ML -> NFeQueue: sem
// filtro de loja, sem exigir situacao=NFE_AGENDADA, sem escalonar pra
// verificação humana em erro — usada pelo módulo PDV, onde a geração é uma
// ação direta da loja/CD21, não uma automação com retry. Única validação:
// pedido não pode estar em status finalizador (aberto/em andamento libera).
export class NfeEmissionService {
  async emitForOrder(orderId: string): Promise<void> {
    const order = await ordersService.findById(orderId);
    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    if (
      TERMINAL_ORDER_INTERNAL_STATUSES.includes(
        order.internal_status as OrderInternalStatus,
      )
    ) {
      throw new Error(
        `Pedido está em status finalizador (${order.internal_status}) — não é possível gerar NFe`,
      );
    }

    try {
      await blingPost(
        `/pedidos/vendas/${order.id_order_system}/gerar-nfe`,
        undefined,
        blingApi,
        { timeout: 45_000 },
      );
    } catch (error: any) {
      const fields = error.response?.data?.error?.fields ?? [];
      const noStock = fields.some((f: any) => f.code === 74);
      throw new Error(
        noStock
          ? "Item(s) sem estoque disponível na Bling"
          : (error.response?.data?.error?.message ??
              "Falha ao gerar NFe na Bling"),
      );
    }

    await ordersService.update(order.id, {
      nfe_emitted: true,
      internal_status: OrderInternalStatus.EMITTED,
    });
  }
}

export default new NfeEmissionService();
