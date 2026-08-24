export type SupplierDiscountType = "REAL" | "PERCENTUAL";

export interface SupplierDiscountRuleAttributes {
  id: string;
  quantity_step: number;
  discount_type: SupplierDiscountType;
  discount_value: number;
  start_date: Date;
  end_date: Date;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierDiscountRuleCreationAttributes
  extends Omit<
    SupplierDiscountRuleAttributes,
    "id" | "active" | "createdAt" | "updatedAt"
  > {
  active?: boolean;
}

// Payload de create/update do service — a regra em si + os 4 conjuntos de
// escopo. brand_ids/rim_ids/measure_ids vazios = curinga (não restringe o
// eixo). unit_business_ids nunca pode ser vazio (validado em runtime pelo
// service). Todos os campos são opcionais aqui só pra manter create/update
// estruturalmente compatíveis com o Partial<...> herdado de BaseService —
// a obrigatoriedade real é validada em runtime / pela constraint NOT NULL.
export interface SupplierDiscountRuleInput {
  quantity_step?: number;
  discount_type?: SupplierDiscountType;
  discount_value?: number;
  start_date?: Date | string;
  end_date?: Date | string;
  active?: boolean;
  brand_ids?: string[];
  rim_ids?: string[];
  measure_ids?: string[];
  unit_business_ids?: string[];
}

// Forma devolvida por GET (show/index) — mesmo formato de SupplierDiscountRuleInput
// pros 4 conjuntos de escopo, pra poder reenviar direto num PUT sem remapear
// nada no front (fetch pro form de edição -> mesmo shape do submit).
export interface SupplierDiscountRuleDetail {
  id: string;
  quantity_step: number;
  discount_type: SupplierDiscountType;
  discount_value: number;
  start_date: Date;
  end_date: Date;
  active: boolean;
  brand_ids: string[];
  rim_ids: string[];
  measure_ids: string[];
  unit_business_ids: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

// Item de entrada de resolveForItems — chave de pool (order_id + escopo) e
// os valores já resolvidos (quantidade real considerando kit, valor bruto).
export interface SupplierDiscountResolveItemInput {
  order_item_id: string;
  order_id: string;
  brand_id: string | null;
  rim_id: string | null;
  measure_id: string | null;
  unit_business_id: string;
  order_date: Date;
  real_quantity: number;
  gross_total: number;
}

export interface SupplierDiscountResolveResult {
  discountValue: number;
  ruleId: string | null;
}

// Linha crua devolvida por matchBatch: uma regra candidata pra um item —
// pode haver várias linhas por item (níveis de REAL se sobrepondo).
export interface SupplierDiscountCandidateRow {
  order_item_id: string;
  rule_id: string;
  discount_type: SupplierDiscountType;
  quantity_step: number;
  discount_value: number;
}
