import { SqlExpression } from "../../../../../shared/query/sequelize-helpers/arithmetic";

export interface FactKeyColumn {
  fact: string;
  snapshot: string;
}

export interface FactTableSpec {
  factTable: string;
  snapshotTable: string;
  keyColumns: FactKeyColumn[];
}

const ORDER_DAY_KEYS: FactKeyColumn[] = [
  { fact: "fact_date", snapshot: "order_date" },
  { fact: "unit_business_id", snapshot: "unit_business_id" },
];

export const DAILY_SALES_FACT_TABLES: FactTableSpec[] = [
  {
    factTable: "daily_sales_facts",
    snapshotTable: "sales_order_snapshots",
    keyColumns: ORDER_DAY_KEYS,
  },
  {
    factTable: "daily_sales_state_facts",
    snapshotTable: "sales_order_snapshots",
    keyColumns: [...ORDER_DAY_KEYS, { fact: "destination_uf", snapshot: "destination_uf" }],
  },
  {
    factTable: "daily_sales_store_facts",
    snapshotTable: "sales_order_snapshots",
    keyColumns: [...ORDER_DAY_KEYS, { fact: "store_id", snapshot: "store_id" }],
  },
  {
    factTable: "daily_sales_product_facts",
    snapshotTable: "sales_order_item_snapshots",
    keyColumns: [...ORDER_DAY_KEYS, { fact: "sku", snapshot: "sku" }],
  },
  {
    factTable: "daily_sales_status_facts",
    snapshotTable: "sales_order_snapshots",
    keyColumns: [
      ...ORDER_DAY_KEYS,
      { fact: "integration_id", snapshot: "integration_id" },
      { fact: "status_normalized", snapshot: "status_snapshot" },
    ],
  },
];

// Linha cuja chave não tem nenhum snapshot recalcularia para zero; sobra quando o snapshot some fora do job (delete, recriação, data alterada).
export function deleteOrphanFactsSql(spec: FactTableSpec): SqlExpression {
  const keyMatch = spec.keyColumns
    .map(({ fact, snapshot }) => `snap.${snapshot} = f.${fact}`)
    .join(" AND ");

  return `DELETE FROM ${spec.factTable} f WHERE NOT EXISTS (SELECT 1 FROM ${spec.snapshotTable} snap WHERE ${keyMatch})`;
}
