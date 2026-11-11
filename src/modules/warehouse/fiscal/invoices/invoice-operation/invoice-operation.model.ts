import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../../config/sequelize";
import { InvoiceOperationAttributes, InvoiceOperationCreationAttributes } from "./invoice-operation.types";

// Operação da nota (venda, compra, transferência...), referenciada por invoices.invoice_operation_id.
class InvoiceOperation
  extends Model<InvoiceOperationAttributes, InvoiceOperationCreationAttributes>
  implements InvoiceOperationAttributes
{
  public id!: string;
  public code!: string;
  public description!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceOperation.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "invoice_operations",
    timestamps: true,
    underscored: true,
  },
);

export default InvoiceOperation;
