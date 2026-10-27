export interface OrderCouponAttributes {
  order_id: string;
  coupon_id: string;
  contact_coupon_id?: string | null;
  discount_amount: number;
  commission_rate?: number | null;
  commission_amount?: number | null;
  createdAt?: Date;
}

export type OrderCouponCreationAttributes = Omit<OrderCouponAttributes, "createdAt">;

// Cupom lido do pedido da Magento (job fetch-order da MAGENTO_SYNC).
export interface RegisterOrderCouponDto {
  orderId: string;
  couponCode: string;
  discountAmount: number;
}
