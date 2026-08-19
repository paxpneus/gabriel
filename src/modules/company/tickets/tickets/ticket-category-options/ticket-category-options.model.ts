import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import {
  TicketCategoryOptionAttributes,
  TicketCategoryOptionCreationAttributes,
} from "./ticket-category-options.types";
class TicketCategoryOption
  extends Model<
    TicketCategoryOptionAttributes,
    TicketCategoryOptionCreationAttributes
  >
  implements TicketCategoryOptionAttributes
{
  public ticket_id!: string;
  public category_option_id!: string;
}
TicketCategoryOption.init(
  {
    ticket_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "tickets", key: "id" },
    },
    category_option_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
      references: { model: "category_options", key: "id" },
    },
  },
  {
    sequelize,
    tableName: "ticket_category_options",
    timestamps: false,
    underscored: true,
  },
);
export default TicketCategoryOption;
