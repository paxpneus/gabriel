import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../../../config/sequelize";
import {
  CategoryAttributes,
  CategoryCreationAttributes,
} from "./categories.types";

import CategoryOption from "../category_options/category-options.model";
class Category
  extends Model<CategoryAttributes, CategoryCreationAttributes>
  implements CategoryAttributes
{
  public id!: number;
  public name!: string;
  public description!: string | null;
  public color!: string | null;
  public options?: CategoryOption[] | null
  public is_active!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
Category.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    color: { type: DataTypes.STRING(7), allowNull: true },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  { sequelize, tableName: "categories", timestamps: true, underscored: true },
);
export default Category;
