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
  public xml_path?: string;
  public danfe_path?: string;
  public unit_business_id!: string;
  public store_id!: string;
  public sender_cnpj!: string;
  public sender_name!: string;
  public receiver_cnpj!: string;
  public receiver_name!: string;
  public integrations_id?: string;
  public id_system?: string;
  public transporter_id?: string;
  public type!: "INCOMING" | "OUTGOING";
  public status!: "OPEN" | "PENDING" | "FINISHED" | "CANCELLED" | "FREE_TO_SCHEDULE" | "WAITING_SCHEDULE_SALES" | "SCHEDULED" | "LATE";
  public batch_generated!: boolean;
  public printed_label!: boolean;
  public emitted_at?: Date;
  public received_at?: string;
  public expected_receiving?: string;
  public number_system?: string;
  public xml_key?: string;
  public transporter_name?: string;
  public transporter_document?: string;
  public total_read!: number;
  public total_expected!: number;
  public description?: string;

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
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    xml_path: {
      type: DataTypes.TEXT,
    },
    xml_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    danfe_path: {
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
    store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "stores",
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
        model: "integrations",
        key: "id",
      },
    },
    id_system: {
      type: DataTypes.STRING(100),
      unique: true,
    },
    transporter_id: {
      type: DataTypes.UUID,
      references: {
        model: "transporters",
        key: "id",
      },
    },
    transporter_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    transporter_document: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("INCOMING", "OUTGOING"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(
        "OPEN",
        "PENDING",
        "FINISHED",
        "FREE_TO_SCHEDULE",
        "WAITING_SCHEDULE_SALES",
        "SCHEDULED",
        "LATE",
        "CANCELLED",
      ),
      defaultValue: "PENDING",
      allowNull: false,
    },
    batch_generated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    printed_label: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    emitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    received_at: {
      type: DataTypes.DATEONLY, 
      allowNull: true,
    },
    expected_receiving: {
  type: DataTypes.DATEONLY, 
  allowNull: true,
},
    number_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    total_read: {
      type: DataTypes.VIRTUAL,
      allowNull: true,
    },
    total_expected: {
  type: DataTypes.VIRTUAL,
  allowNull: true,
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
