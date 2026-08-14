import { StockMovementAttributes } from "../stock/stock-movements/stock-movements.types";
import Stock from "../stock/stock/stock.model";
import { SupplierMappingAttributes } from "../supplier-mapping/supplier-mapping.types";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
  ean?: string;
  ean_tribut?: string;
  id_system?: string;
  type?: string;
  category?: string;
  integrations_id?: string;
  supplier_id?: string;
  brand_id?: string | null;
  source_payload?: Record<string, unknown> | null;
  unit?: string;
  brand?: string;
  commission?: number;
  line?: string | null;
  measure?: string | null;
  rim?: string | null;
  gross_weight?: number;
  net_weight?: number;
  stock_virtual_total?: number;
  subgroup_id?: string;
  createdAt?: Date;
  updatedAt?: Date;


  supplierMappings?: SupplierMappingAttributes[]
}

export interface ProductCreationAttributes extends Omit<
  ProductAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export interface ProductWithStock extends Product {
  stocks: Stock[];
}

export type AverageCostTrend = "INCREASED" | "DECREASED" | "UNCHANGED";

export type ProductDetailedWithMovements = Product & {
  stocks: Stock[]

  subgroup: unknown | null;
  brandRegister: unknown | null;

  productConfigs: unknown[];

  lastPurchaseEntries: StockMovementAttributes[];

  currentAverageCost?: number;
};

export type ProductDetailedWithMovementsSummary = ProductAttributes & {
  stocks: Stock[]

  subgroup: unknown | null;
  brandRegister: unknown | null;
  productConfigs: unknown[];

  currentAverageCost?: number;

  last_movement: {
    balance: number;
    average_cost: number;
  };

  second_movement: {
    balance: number;
    average_cost: number;
  };

  average_cost_trend: AverageCostTrend;
  average_cost_difference: number;
};

export type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: "positive" | "zero";
};

export type LastMovementDateRangeFilter = {
  start?: string;
  end?: string;
};

export type LastMovementDateRangeDate = {
  start?: Date;
  end?: Date;
};