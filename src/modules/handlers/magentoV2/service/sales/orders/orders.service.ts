import { magentoApi } from "../../../api/magentoV2_api";
import { MagentoOrderCoupon } from "./orders.types";

const ORDER_COUPON_FIELDS = "entity_id,increment_id,coupon_code,discount_amount";

export class MagentoSalesOrderService {
  /** GET /rest/V1/orders/{entity_id} — só os campos de cupom. */
  async getOrderCoupon(entityId: string): Promise<MagentoOrderCoupon> {
    return magentoApi
      .get(`/orders/${entityId}`, { params: { fields: ORDER_COUPON_FIELDS } })
      .then((r) => r.data);
  }
}

export default new MagentoSalesOrderService();
