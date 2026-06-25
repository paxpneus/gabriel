import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  InvoiceUnitBusinessAttributesAttributes,
  InvoiceUnitBusinessAttributesCreationAttributes,
  InvoiceUnitBusinessAttributesStatus,
} from "./invoice-unit-business-attributes.types";

class InvoiceUnitBusinessAttributes
  extends Model<
    InvoiceUnitBusinessAttributesAttributes,
    InvoiceUnitBusinessAttributesCreationAttributes
  >
  implements InvoiceUnitBusinessAttributesAttributes
{
  public id!: string;
  public unit_business_id!: string;
  public invoice_id!: string;
  public type!: "INCOMING" | "OUTGOING";
  public status!: InvoiceUnitBusinessAttributesStatus;
  public batch_generated!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceUnitBusinessAttributes.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "invoices",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
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
        "PENDING_CANCELLED_SYSTEM",
      ),
      allowNull: false,
      defaultValue: "PENDING",
    },
    batch_generated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "invoice_unit_business_attributes",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["invoice_id", "unit_business_id"],
        name: "uq_invoice_unit_business_attributes_invoice_unit_business",
      },
    ],
  },
);

export default InvoiceUnitBusinessAttributes;