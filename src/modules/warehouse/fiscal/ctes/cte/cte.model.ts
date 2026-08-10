import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { CteAttributes, CteCreationAttributes, CteTakerType } from "./cte.types";

class Cte 
  extends Model<CteAttributes, CteCreationAttributes>
  implements CteAttributes
{
  public id!: string;
  public xml_key!: string;
  public number!: number;
  public series!: number;
  public total_value!: number;
  public issue_date!: Date;
  public operation_date!: Date;
  public issuer_tax_id!: string;
  public sender_tax_id!: string | null;
  public recipient_tax_id!: string | null;
  public dispatcher_tax_id!: string | null;
  public receiver_tax_id!: string | null;
  public taker_type!: CteTakerType | null;
  public taker_tax_id!: string | null;
  public xml_path!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Cte.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    xml_key: {
      type: DataTypes.STRING(44),
      allowNull: false,
      unique: true,
    },
    number: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    series: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    total_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    issue_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    operation_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    issuer_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    sender_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: true,
    },
    recipient_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: true,
    },
    dispatcher_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: true,
    },
    receiver_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: true,
    },
    taker_type: {
      type: DataTypes.ENUM(
        "ISSUER",
        "DISPATCHER",
        "RECEIVER",
        "ADDRESSEE",
        "THIRD_PARTY"
      ),
      allowNull: true,
    },
    taker_tax_id: {
      type: DataTypes.STRING(14),
      allowNull: true,
    },
    xml_path: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "ctes",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ["xml_key"],
        unique: true,
        name: "ctes_xml_key_unique_idx",
      },
      {
        fields: ["issuer_tax_id", "issue_date"],
        name: "ctes_issuer_date_idx",
      },
      {
        fields: ["recipient_tax_id"],
        name: "ctes_recipient_tax_id_idx",
      },
    ],
  }
);

export default Cte;