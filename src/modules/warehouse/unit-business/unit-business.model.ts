import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  UnitBusinessAttributes,
  UnitBusinessCreationAttributes,
} from "./unit-business.types";
import { v4 as uuidv4 } from "uuid";
import { normalizeDocument } from "../../../shared/utils/normalizers/document";

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
  public ult_nsu?: string
  public emails?: string[] | null;

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
      unique: true,
    },
    number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
    },
    ult_nsu: {
      type: DataTypes.STRING(15),
      allowNull: false,
      defaultValue: "000000000000000",
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    cnpj: {
      type: DataTypes.STRING(18),
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
    emails: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
      defaultValue: [],
    },
  },
  {
    sequelize,
    tableName: "unit_businesses",
    timestamps: true,
    underscored: true,
  },
);

UnitBusiness.beforeCreate((unitBusiness) => normalizeDocument(unitBusiness))
UnitBusiness.beforeUpdate((unitBusiness) => normalizeDocument(unitBusiness))

export default UnitBusiness;
