import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  ExternalOrderStatusMappingAttributes,
  ExternalOrderStatusMappingCreationAttributes,
} from "./external-order-status-mapping.types";

class ExternalOrderStatusMapping
  extends Model<
    ExternalOrderStatusMappingAttributes,
    ExternalOrderStatusMappingCreationAttributes
  >
  implements ExternalOrderStatusMappingAttributes
{
  public id!: string;
  public integration_id?: string | null;
  public source_system?: string | null;
  public external_status_id!: string;
  public external_status_value?: string | null;
  public normalized_status!: string;
  public display_name!: string;
  public is_cancelled?: boolean;
  public is_final?: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExternalOrderStatusMapping.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    integration_id: { type: DataTypes.UUID, allowNull: true },
    source_system: { type: DataTypes.STRING(50), allowNull: true },
    external_status_id: { type: DataTypes.STRING(50), allowNull: false },
    external_status_value: { type: DataTypes.STRING(100), allowNull: true },
    normalized_status: { type: DataTypes.STRING(100), allowNull: false },
    display_name: { type: DataTypes.STRING(100), allowNull: false },
    is_cancelled: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_final: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    sequelize,
    tableName: "external_order_status_mappings",
    timestamps: true,
    underscored: true,
  },
);

export default ExternalOrderStatusMapping;
