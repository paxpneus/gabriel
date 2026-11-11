import { magentoApi } from "../../../api/magentoV2_api";

// Pedidos de venda da Magento (REST /orders).
export class MagentoSalesOrderService {
  // Só os campos do cupom (+ created_at, UTC "YYYY-MM-DD HH:mm:ss", hora real da venda): `fields` pra não trazer o pedido inteiro.
  async getOrderCoupon(entityId: string): Promise<{
    entity_id: number;
    increment_id?: string;
    coupon_code?: string | null;
    discount_amount?: number | null;
    created_at?: string | null;
  }> {
    return magentoApi
      .get(`/orders/${encodeURIComponent(entityId)}`, {
        params: { fields: "entity_id,increment_id,coupon_code,discount_amount,created_at" },
      })
      .then((r) => r.data);
  }
}

export default new MagentoSalesOrderService();
