import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  InvoiceLogisticOcurrencesAttributes,
  InvoiceLogisticOcurrencesCreationAttributesAttributes,
  InvoiceLogisticOcurrencesStatus,
} from "./invoice-logistic-occurrences.types";
import { v4 as uuidv4 } from "uuid";

class InvoiceLogisticOccurrences
  extends Model<
    InvoiceLogisticOcurrencesAttributes,
    InvoiceLogisticOcurrencesCreationAttributesAttributes
  >
  implements InvoiceLogisticOcurrencesAttributes
{
  public id!: string;
  public invoice_id!: string;
  public occurrency_code!: string;
  public description!: string;
  public proof_link!: string;
  public status!: InvoiceLogisticOcurrencesStatus;
  public date?: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceLogisticOccurrences.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true,
      allowNull: false,
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "invoices",
        key: "id",
      },
    },
    occurrency_code: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    proof_link: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "SYNCHRONIZED"),
      allowNull: false,
      defaultValue: "PENDING",
    },
  },
  {
    sequelize,
    tableName: "invoice_logistic_occurrences",
    timestamps: true,
    underscored: true,
  }
);

export default InvoiceLogisticOccurrences;