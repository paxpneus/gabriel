import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  CarrierImportLayoutAttributes,
  CarrierImportLayoutCreationAttributes,
  CarrierImportLayoutMappingMode,
  CarrierImportLayoutType,
} from "./carrier-import-layouts.types";

class CarrierImportLayout
  extends Model<
    CarrierImportLayoutAttributes,
    CarrierImportLayoutCreationAttributes
  >
  implements CarrierImportLayoutAttributes
{
  public id!: string;
  public transporter_id!: string;
  public name!: string;
  public type!: CarrierImportLayoutType;
  public sheet_name?: string | null;
  public data_start_row!: number;
  public mapping_mode!: CarrierImportLayoutMappingMode;
  public zip_from_label!: string;
  public zip_to_label!: string;
  public route_code_label?: string | null;
  public destination_label?: string | null;
  public observation_label?: string | null;
  public metadata?: Record<string, any> | null;
  public active!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CarrierImportLayout.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    transporter_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "transporters",
        key: "id",
      },
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("EXCEL", "CSV"),
      allowNull: false,
      defaultValue: "EXCEL",
    },
    sheet_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    data_start_row: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    },
    mapping_mode: {
      type: DataTypes.ENUM("HEADER", "COLUMN"),
      allowNull: false,
      defaultValue: "HEADER",
    },
    zip_from_label: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    zip_to_label: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    route_code_label: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    destination_label: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    observation_label: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "carrier_import_layouts",
    timestamps: true,
    underscored: true,
  },
);

export default CarrierImportLayout;
