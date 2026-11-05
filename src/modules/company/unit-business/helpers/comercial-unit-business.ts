import { Op, WhereOptions } from "sequelize";
import { WEBSITE_PAX_UNIT_BUSINESS_ID_SYSTEM } from "./website-pax-unit-business";

export function comercialUnitBusinessWhere(): WhereOptions {
  return {
    type: "PHYSICAL",
    number: {
      [Op.ne]: "0",
    },
  };
}

// Lojas comerciais + site Pax (online, sem número) — o site opera o PDV como loja.
export function comercialWithWebsitePaxWhere(): WhereOptions {
  return {
    [Op.or]: [
      comercialUnitBusinessWhere(),
      { id_system: WEBSITE_PAX_UNIT_BUSINESS_ID_SYSTEM },
    ],
  };
}
