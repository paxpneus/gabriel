export const COUPON_DISCOUNT_TYPES = ["percent", "fixed"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export interface CouponAttributes {
  id: string;
  code: string;
  discount_type?: CouponDiscountType | null;
  discount_value?: number | string | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CouponCreationAttributes
  extends Omit<CouponAttributes, "id" | "active" | "createdAt" | "updatedAt"> {
  active?: boolean;
}
