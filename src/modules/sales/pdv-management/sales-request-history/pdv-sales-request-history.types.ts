import { PdvSalesRequestStatus } from "../sales-request/pdv-sales-request.types";

export interface PdvSalesRequestHistoryAttributes {
  id: string;
  pdv_sales_request_id: string;
  step: PdvSalesRequestStatus;
  description: string;
  date: Date;
  user_id: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PdvSalesRequestHistoryCreationAttributes = Omit<
  PdvSalesRequestHistoryAttributes,
  "id" | "createdAt" | "updatedAt"
>;
