import { Op, WhereOptions } from "sequelize";
import sequelize from "../../../../../config/sequelize";

export function pendingQuantityWhere(): WhereOptions {
  return {
    quantity_read: { [Op.lt]: sequelize.col("quantity_expected") },
  };
}
