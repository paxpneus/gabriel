import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { BrandAttributes, BrandCreationAttributes } from "./brands.types";

class Brand
  extends Model<BrandAttributes, BrandCreationAttributes>
  implements BrandAttributes
{
  public id!: string;
  public name!: string;
  public seller_comission_tax_rate!: number;
  public manager_comission_tax_rate!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Brand.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    seller_comission_tax_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },
    manager_comission_tax_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "brands",
    timestamps: true,
    underscored: true,
  },
);

export default Brand;
