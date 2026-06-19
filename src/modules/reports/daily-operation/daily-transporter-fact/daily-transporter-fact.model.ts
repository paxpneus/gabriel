import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailyTransporterFactAttributes,
  DailyTransporterFactCreationAttributes,
} from "./daily-transporter-fact.types";

class DailyTransporterFact
  extends Model<
    DailyTransporterFactAttributes,
    DailyTransporterFactCreationAttributes
  >
  implements DailyTransporterFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id!: string;
  public transporter_id!: string;
  public volumes_dispatched?: number;
  public invoices_count?: number;
  public invoices_fully_processed?: number;
  public last_updated_at?: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailyTransporterFact.init(
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
    transporter_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "transporters", key: "id" },
    },
    volumes_dispatched: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    invoices_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    invoices_fully_processed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    last_updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "daily_transporter_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailyTransporterFact;
