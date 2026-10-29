import { Op, Sequelize, WhereOptions } from "sequelize";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entradas de compra. */
export function inputMovementsWhere(): WhereOptions {
  return { movement_type: "PURCHASE_ENTRY" };
}

/** Devoluções de cliente (entram como entrada ao custo e abatem a saída). */
export function customerReturnMovementsWhere(): WhereOptions {
  return { movement_type: "CUSTOMER_RETURN" };
}

/**
 * Saídas de venda: SALE_OUT (NF) + ajuste OUT com invoice_number (pedido de
 * venda importado do CSV Bling). Balanço/ajuste sem origem fica de fora.
 */
export function outputMovementsWhere(): WhereOptions {
  return {
    [Op.or]: [
      { movement_type: "SALE_OUT" },
      {
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "OUT",
        invoice_number: { [Op.ne]: null },
      },
    ],
  };
}

/**
 * Movimento cuja venda é de uma das lojas: nota (`invoice_id` ou `bling_origin_id` = id Bling)
 * pela `origin_unit_business_id`; pedido do CSV (ajuste com nº do pedido) pela `unit_business_id`.
 */
export function saleUnitBusinessWhere(
  unitBusinessIds: string[],
  alias: string = "StockMovement",
): WhereOptions {
  // Ids interpolados no SQL cru: só UUID válido entra; nenhum válido → nada bate.
  const validIds = unitBusinessIds.filter((id) => UUID_RE.test(id));
  if (!validIds.length) return { [Op.and]: [Sequelize.literal("FALSE")] };
  const ids = `ARRAY[${validIds.map((id) => `'${id}'`).join(", ")}]::uuid[]`;
  return {
    [Op.and]: [
      Sequelize.literal(`(
    ("${alias}"."movement_type" <> 'MANUAL_ADJUSTMENT' AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE (i.id = "${alias}"."invoice_id" OR i.id_system = "${alias}"."bling_origin_id")
        AND i.origin_unit_business_id = ANY(${ids})
    ))
    OR ("${alias}"."movement_type" = 'MANUAL_ADJUSTMENT' AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.number_order_system = "${alias}"."invoice_number"
        AND o.unit_business_id = ANY(${ids})
    ))
  )`),
    ],
  };
}

/** Movimentos ativos de uma unidade dentro de [start, end]. */
export function unitBusinessPeriodWhere(
  unitBusinessId: string,
  start: Date,
  end: Date,
): WhereOptions {
  return {
    unit_business_id: unitBusinessId,
    is_active: true,
    movement_date: { [Op.between]: [start, end] },
  };
}
