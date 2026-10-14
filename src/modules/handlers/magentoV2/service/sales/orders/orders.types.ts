export interface MagentoOrderCoupon {
  entity_id: number;
  increment_id?: string;
  coupon_code?: string | null;
  // Magento manda negativo.
  discount_amount?: number | null;
}
