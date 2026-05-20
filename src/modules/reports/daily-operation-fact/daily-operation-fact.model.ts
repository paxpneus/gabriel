import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../config/sequelize";
import {
  DailyOperationFactAttributes,
  DailyOperationFactCreationAttributes,
} from "./daily-operation-fact.types";

class DailyOperationFact
  extends Model<DailyOperationFactAttributes, DailyOperationFactCreationAttributes>
  implements DailyOperationFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id!: string;
  public invoices_incoming_count?: number;
  public invoices_outgoing_count?: number;
  public volumes_received?: number;
  public volumes_dispatched?: number;
  public invoices_incoming_total?: number;
  public invoices_outgoing_total?: number;
  public invoices_incoming_fully_processed?: number;
  public invoices_outgoing_fully_processed?: number;
  public outgoing_perf_avg_minutes?: number | string | null;
  public outgoing_perf_min_minutes?: number | string | null;
  public outgoing_perf_max_minutes?: number | string | null;
  public outgoing_perf_invoice_count?: number;
  public incoming_perf_avg_minutes?: number | string | null;
  public incoming_perf_min_minutes?: number | string | null;
  public incoming_perf_max_minutes?: number | string | null;
  public incoming_perf_invoice_count?: number;
  public last_updated_at?: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailyOperationFact.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    fact_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "unit_businesses", key: "id" },
    },
    invoices_incoming_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    invoices_outgoing_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    volumes_received: { type: DataTypes.INTEGER, defaultValue: 0 },
    volumes_dispatched: { type: DataTypes.INTEGER, defaultValue: 0 },
    invoices_incoming_total: { type: DataTypes.INTEGER, defaultValue: 0 },
    invoices_outgoing_total: { type: DataTypes.INTEGER, defaultValue: 0 },
    invoices_incoming_fully_processed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    invoices_outgoing_fully_processed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    outgoing_perf_avg_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    outgoing_perf_min_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    outgoing_perf_max_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    outgoing_perf_invoice_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    incoming_perf_avg_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    incoming_perf_min_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    incoming_perf_max_minutes: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    incoming_perf_invoice_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    last_updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "daily_operation_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailyOperationFact;
