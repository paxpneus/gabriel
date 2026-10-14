export interface OrderCouponAttributes {
  order_id: string;
  coupon_id: string;
  contact_coupon_id?: string | null;
  discount_amount: number | string;
  commission_rate?: number | string | null;
  commission_amount?: number | string | null;
  createdAt?: Date;
}

export type OrderCouponCreationAttributes = Omit<OrderCouponAttributes, "createdAt">;

export interface RegisterOrderCouponInput {
  orderId: string;
  couponCode: string;
  discountAmount: number;
}
