export interface PaymentMethodAttributes {
  id: string;
  integrations_id: string;
  id_system: string;
  description: string;
  payment_type: number | null;
  raw_payload: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PaymentMethodCreationAttributes = Omit<
  PaymentMethodAttributes,
  "id" | "createdAt" | "updatedAt"
>;
