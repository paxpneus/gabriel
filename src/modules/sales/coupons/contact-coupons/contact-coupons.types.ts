export interface ContactCouponAttributes {
  id: string;
  contact_id: string;
  coupon_id: string;
  commission_rate: number;
  active: boolean;
  deactivated_at?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ContactCouponCreationAttributes = Omit<
  ContactCouponAttributes,
  "id" | "active" | "createdAt" | "updatedAt"
> & { active?: boolean };

// Body do POST /contact-coupons (vínculo) e do POST /contact-coupons/transfer (novo dono).
export interface LinkContactCouponDto {
  contact_id: string;
  coupon_id: string;
  commission_rate: number;
}
