import { SqlExpression } from "../../../../../shared/query/sequelize-helpers/arithmetic";

export const FACT_KEYS_PER_STATEMENT = 1000;

export type FactKeyColumnType = "date" | "uuid" | "varchar";

export interface FactKeyColumnDef {
  name: string;
  type: FactKeyColumnType;
}

// Lote de chaves vira tabela (jsonb_to_recordset): um statement por lote em vez de um por chave.
export function factKeysTableSql(
  columns: FactKeyColumnDef[],
  param = "keys",
): SqlExpression {
  const definitions = columns.map((c) => `${c.name} ${c.type}`).join(", ");
  return `SELECT DISTINCT * FROM jsonb_to_recordset(CAST(:${param} AS jsonb)) AS k(${definitions})`;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  return Array.from(new Map(items.map((item) => [keyOf(item), item])).values());
}
