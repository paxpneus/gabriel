export interface OrderPaymentAttributes {
  id: string;
  order_id: string;
  payment_method_id: string;
  id_system: string | null;
  amount: number;
  due_date: string | null;
  notes: string | null;
  form_description: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderPaymentCreationAttributes = Omit<
  OrderPaymentAttributes,
  "id" | "createdAt" | "updatedAt"
>;
