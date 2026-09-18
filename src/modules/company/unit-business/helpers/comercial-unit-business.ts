import { Op, WhereOptions } from "sequelize";

export function comercialUnitBusinessWhere(): WhereOptions {
  return {
    type: "PHYSICAL",
    number: {
      [Op.ne]: "0",
    },
  };
}
