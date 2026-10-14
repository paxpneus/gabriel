export interface ContactCouponAttributes {
  id: string;
  contact_id: string;
  coupon_id: string;
  commission_rate: number | string;
  active: boolean;
  deactivated_at?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ContactCouponCreationAttributes
  extends Omit<ContactCouponAttributes, "id" | "active" | "createdAt" | "updatedAt"> {
  active?: boolean;
}
