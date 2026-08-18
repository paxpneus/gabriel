import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../../../config/sequelize";
import {
  CategoryOptionAttributes,
  CategoryOptionCreationAttributes,
} from "./category-options.types";
class CategoryOption
  extends Model<CategoryOptionAttributes, CategoryOptionCreationAttributes>
  implements CategoryOptionAttributes
{
  public id!: string;
  public category_id!: string;
  public label!: string;
  public value!: string | null;
  public color!: string | null;
  public display_order!: number;
  public is_active!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
CategoryOption.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "categories", key: "id" },
    },
    label: { type: DataTypes.STRING(100), allowNull: false },
    value: { type: DataTypes.STRING(100), allowNull: true },
    color: { type: DataTypes.STRING(7), allowNull: true },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "category_options",
    timestamps: true,
    underscored: true,
  },
);
export default CategoryOption;
