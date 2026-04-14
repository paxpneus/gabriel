import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { InvoiceAttributes, InvoiceCreationAttributes } from "./invoice.types";
import { v4 as uuidv4 } from "uuid";

class Invoice
  extends Model<InvoiceAttributes, InvoiceCreationAttributes>
  implements InvoiceAttributes
{
  public id!: string;
  public customer_name!: string;
  public customer_document!: string;
  public key!: string;
  public xml_path?: string;
  public unit_business_id!: string;
  public sender_cnpj!: string;
  public sender_name!: string;
  public receiver_cnpj!: string;
  public receiver_name!: string;
  public integrations_id?: string;
  public id_system?: string;
  public transporter_id?: string;
  public type!: "INCOMING" | "OUTGOING";
  public status!: "OPEN" | "PENDING" | "FINISHED" | "CANCELLED";

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Invoice.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    customer_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    customer_document: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    key: {
      type: DataTypes.STRING(44),
      allowNull: false,
      unique: true,
    },
    xml_path: {
      type: DataTypes.TEXT,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    sender_cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    sender_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    receiver_cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    receiver_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      references: {
                model: 'integrations',
                key: 'id'
            }
    },
    id_system: {
      type: DataTypes.STRING(100),
    },
    transporter_id: {
      type: DataTypes.UUID,
      references: {
        model: "transporters",
        key: "id",
      },
    },
    type: {
      type: DataTypes.ENUM("INCOMING", "OUTGOING"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("OPEN", "PENDING", "FINISHED", "CANCELLED"),
      defaultValue: "PENDING",
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "invoices",
    timestamps: true,
    underscored: true,
  },
);

export default Invoice;
