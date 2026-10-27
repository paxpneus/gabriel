// percent = % sobre o pedido; fixed = valor em reais. Só informativo: a comissão não depende disso.
export const COUPON_DISCOUNT_TYPES = ["percent", "fixed"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export interface CouponAttributes {
  id: string;
  code: string;
  discount_type?: CouponDiscountType | null;
  discount_value?: number | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type CouponCreationAttributes = Omit<
  CouponAttributes,
  "id" | "active" | "createdAt" | "updatedAt"
> & { active?: boolean };
