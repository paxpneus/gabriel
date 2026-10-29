import { StockMovementAttributes } from "../stock/stock-movements/stock-movements.types";
import Stock from "../stock/stock/stock.model";
import { SupplierMappingAttributes } from "../supplier-mapping/supplier-mapping.types";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
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
  measure_id?: string | null;
  rim_id?: string | null;
  gross_weight?: number;
  net_weight?: number;
  stock_virtual_total?: number;
  subgroup_id?: string;
  is_active?: boolean;
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

// Filtros do relatório de vendas por produto (products/sales-report/get) —
// mesma base de dados do sales-report (sales_order_item_snapshots), mas
// agrupado por produto/sku, com filtro extra de quantidade vendida (min/max)
// que não existe no sales-report.
export interface ProductSalesReportFilters {
  dateFrom: string;
  dateTo: string;
  unitBusinessIds?: string[];
  productIds?: string[];
  rim?: string;
  measure?: string;
  productType?: string;
  minQuantitySold?: number;
  maxQuantitySold?: number;
}

export interface ProductSalesReportRow {
  product_id: string | null;
  product_name: string | null;
  sku: string | null;
  quantity_sold: number;
  gross_total: number;
  total_cost: number;
  total_supplier_discount: number;
  contribution_value: number;
  contribution_pct: number;
  markup_value: number;
  markup_pct: number;
  average_cost: number;
  commission_value: number;
}

// Modo da auto busca de pneu: IN_BATCH (bipe em lote de entrada/expedição) só sugere item do lote que falta bipar.
export enum TireSearchMode {
  IN_BATCH = "IN_BATCH",
  NORMAL = "NORMAL",
}

// Probabilidade do candidato pelos opcionais batidos (índice de carga/marca) — a medida é obrigatória e estrita.
export enum TireMatchProbability {
  HIGH = "ALTA",
  MEDIUM = "MEDIA",
  UNLIKELY = "IMPROVAVEL",
}

export interface TireSearchParams {
  mode: TireSearchMode;
  measure: string;
  loadIndex?: string;
  brand?: string;
  expeditionBatchId?: string;
}

// Item da resposta da auto busca; `matches` fica null no opcional não informado.
export interface TireSearchCandidate {
  product: Record<string, unknown>;
  matches: { load_index: boolean | null; brand: boolean | null };
  score: { matched: number; total: number };
  probability: TireMatchProbability | null;
  mapped_in_user_integration: boolean;
}
