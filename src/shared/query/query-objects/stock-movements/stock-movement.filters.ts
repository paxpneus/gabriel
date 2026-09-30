import { Op, WhereOptions } from "sequelize";

/** Entradas de compra. */
export function inputMovementsWhere(): WhereOptions {
  return { movement_type: "PURCHASE_ENTRY" };
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
