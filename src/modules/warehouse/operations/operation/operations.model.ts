import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  OperationsAttributes,
  OperationsCreationAttributes,
  OperationStatus,
} from "./operations.types";
import { v4 as uuidv4 } from "uuid";

class Operations
  extends Model<OperationsAttributes, OperationsCreationAttributes>
  implements OperationsAttributes
{
  public id!: string;
  public description?: string | null;
  public date?: Date | null;
  public due_at?: Date | null;
  public expected_at?: Date | null;
  public status!: OperationStatus;
  public invoice_id?: string | null;
  public from_unit?: string | null;
  public to_unit?: string | null;
  public transporter_name?: string | null;
  public total_quantity!: number;
  public receiver_confirmation?: boolean;
  public sender_confirmation?: boolean;
  public invoice_number?: string;
  public note?: string;
  public code?: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Operations.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    due_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("OPEN", "PENDING", "FINISHED"),
      allowNull: false,
      defaultValue: "OPEN",
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "invoices",
        key: "id",
      },
    },
    invoice_number: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    from_unit: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    to_unit: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    transporter_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    total_quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    receiver_confirmation: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    sender_confirmation: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "operations",
    timestamps: true,
    underscored: true,
  },
);

export default Operations;
