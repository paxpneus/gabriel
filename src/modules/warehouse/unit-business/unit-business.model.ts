import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  UnitBusinessAttributes,
  UnitBusinessCreationAttributes,
} from "./unit-business.types";
import { v4 as uuidv4 } from "uuid";

class UnitBusiness
  extends Model<UnitBusinessAttributes, UnitBusinessCreationAttributes>
  implements UnitBusinessAttributes
{
  public id!: string;
  public number!: string;
  public name!: string;
  public cnpj!: string;
  public id_system!: string;
  public integrations_id?: string;
  public head_office!: boolean;
  public certifcate_password?: string;
  public certificate_path?: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusiness.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    id_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    cnpj: {
      type: DataTypes.STRING(14),
      allowNull: true,
      unique: true,
    },
    integrations_id: {
      type: DataTypes.UUID,
      references: {
        model: "integrations",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    head_office: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    certificate_password: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    certificate_path: {
      type: DataTypes.TEXT,
    },
  },
  {
    sequelize,
    tableName: "unit_businesses",
    timestamps: true,
    underscored: true,
  },
);

export default UnitBusiness;
