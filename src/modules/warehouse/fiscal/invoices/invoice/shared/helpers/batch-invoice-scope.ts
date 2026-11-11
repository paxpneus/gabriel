import { Op, Sequelize, WhereOptions } from "sequelize";

const BATCH_TYPES = ["INCOMING", "OUTGOING"];
// Regex e não o validate do pacote uuid: o setup dos testes mocka "uuid" só com o v4.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!unitBusinessId || !UUID_PATTERN.test(unitBusinessId)) return undefined;
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
