export interface LabelAttributes {
  id: string;
  type: "STOCK" | "SHIPPING";
  name: string;
  layout?: Record<string, unknown> | null; // width, height, qr_position, barcode_position...
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LabelCreationAttributes
  extends Omit<LabelAttributes, "id" | "createdAt" | "updatedAt"> {}