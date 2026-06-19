import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  InvoiceOperationSnapshotAttributes,
  InvoiceOperationSnapshotCreationAttributes,
  InvoiceOperationSnapshotStatus,
  InvoiceOperationSnapshotType,
} from "./invoice-operation-snapshot.types";

class InvoiceOperationSnapshot
  extends Model<
    InvoiceOperationSnapshotAttributes,
    InvoiceOperationSnapshotCreationAttributes
  >
  implements InvoiceOperationSnapshotAttributes
{
  public id!: string;
  public invoice_id!: string;
  public unit_business_id!: string;
  public transporter_id?: string | null;
  public type!: InvoiceOperationSnapshotType;
  public invoice_date?: string | null;
  public emitted_at?: Date | null;
  public delivery_note_generated_at?: Date | null;
  public first_scan_at?: Date | null;
  public last_scan_at?: Date | null;
  public fully_processed_at?: Date | null;
  public total_items_expected?: number;
  public total_items_received?: number;
  public scan_completion_pct?: number | string;
  public hours_emission_to_delivery_note?: number | string | null;
  public hours_batch_to_fully_scanned?: number | string | null;
  public is_supplier_return?: boolean;
  public is_advance_payment?: boolean;
  public snapshot_status?: InvoiceOperationSnapshotStatus;
  public last_updated_at?: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceOperationSnapshot.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: "invoices", key: "id" },
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "unit_businesses", key: "id" },
    },
    transporter_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "transporters", key: "id" },
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    invoice_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    emitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    delivery_note_generated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    first_scan_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_scan_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    fully_processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    total_items_expected: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    total_items_received: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    scan_completion_pct: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0,
    },
    hours_emission_to_delivery_note: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    hours_batch_to_fully_scanned: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    is_supplier_return: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_advance_payment: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    snapshot_status: {
      type: DataTypes.STRING(20),
      defaultValue: "open",
    },
    last_updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "invoice_operation_snapshots",
    timestamps: true,
    underscored: true,
  },
);

export default InvoiceOperationSnapshot;
