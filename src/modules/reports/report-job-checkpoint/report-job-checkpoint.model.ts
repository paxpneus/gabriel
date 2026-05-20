import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../config/sequelize";
import {
  ReportJobCheckpointAttributes,
  ReportJobCheckpointCreationAttributes,
  ReportJobCheckpointStatus,
} from "./report-job-checkpoint.types";

class ReportJobCheckpoint
  extends Model<
    ReportJobCheckpointAttributes,
    ReportJobCheckpointCreationAttributes
  >
  implements ReportJobCheckpointAttributes
{
  public id!: string;
  public job_name!: string;
  public last_processed_at!: Date;
  public last_run_at!: Date;
  public status!: ReportJobCheckpointStatus;
  public rows_processed?: number;
  public metadata?: Record<string, unknown> | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ReportJobCheckpoint.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    job_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    last_processed_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    last_run_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "success",
    },
    rows_processed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "report_job_checkpoints",
    timestamps: true,
    underscored: true,
  },
);

export default ReportJobCheckpoint;
