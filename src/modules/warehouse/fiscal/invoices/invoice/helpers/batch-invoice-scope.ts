import { Op, Sequelize, WhereOptions } from "sequelize";
import { validate as isUuid } from "uuid";

const BATCH_TYPES = ["INCOMING", "OUTGOING"];

// Tipos de lote vindos de filtro (string, array ou { [Op.in]: [...] }), só os válidos — vão interpolados no SQL.
export function batchTypesFromFilter(value: unknown): string[] {
  const raw = (value as any)?.[Op.in] ?? value;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((type): type is string => BATCH_TYPES.includes(type));
}

// `where` do include hasOne `batchInvoice`: a nota pode estar em lotes de várias lojas (e 2 na loja de transbordo),
// e o hasOne pega um vínculo qualquer — restringe ao lote da loja e, na nota de transbordo, ao type pedido.
export function batchInvoiceScopeWhere(
  unitBusinessId: string | undefined,
  types: string[] = [],
  alias = "batchInvoice",
): WhereOptions | undefined {
  if (!unitBusinessId || !isUuid(unitBusinessId)) return undefined;
  const validTypes = types.filter((type) => BATCH_TYPES.includes(type));
  const typeSql = validTypes.length
    ? `AND ("${alias}"."is_transshipment" = false OR b.type IN (${validTypes.map((type) => `'${type}'`).join(", ")}))`
    : "";
  return {
    [Op.and]: [
      Sequelize.literal(`EXISTS (
        SELECT 1 FROM expedition_batches b
        WHERE b.id = "${alias}"."expedition_batch_id"
          AND b.unit_business_id = '${unitBusinessId}'
          ${typeSql}
      )`),
    ],
  };
}
