import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  StockMovementSourceDataAttributes,
  StockMovementSourceDataCreationAttributes,
} from "./stock-movement-source-data.types";

class StockMovementSourceData
  extends Model<
    StockMovementSourceDataAttributes,
    StockMovementSourceDataCreationAttributes
  >
  implements StockMovementSourceDataAttributes
{
  public id!: string;
  public extraction_date!: Date;
  public cutoff_date!: Date | null;
  public csv_path!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StockMovementSourceData.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    extraction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      unique: true,
    },
    cutoff_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    csv_path: {
      type: DataTypes.STRING(1024),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "stock_movement_source_data",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ["extraction_date"],
        name: "stock_movement_source_data_extraction_date_idx",
        unique: true,
      },
    ],
  },
);

export default StockMovementSourceData;
