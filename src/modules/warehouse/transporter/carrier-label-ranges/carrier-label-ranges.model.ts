import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  CarrierLabelRangeAttributes,
  CarrierLabelRangeCreationAttributes,
} from "./carrier-label-ranges.types";
import { cleanCep } from "../../../../shared/utils/normalizers/document";

class CarrierLabelRange
  extends Model<
    CarrierLabelRangeAttributes,
    CarrierLabelRangeCreationAttributes
  >
  implements CarrierLabelRangeAttributes
{
  public id!: string;
  public transporter_id!: string;
  public cep_start!: string;
  public cep_end!: string;
  public route_acronym!: string;
  public service_name?: string | null;
  public route_code?: string | null;
  public transporter_code!: string;
  public metadata?: Record<string, any> | null;
  public active!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CarrierLabelRange.init(
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
    cep_start: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    cep_end: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    route_acronym: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    service_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    route_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    transporter_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
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
    tableName: "carrier_label_ranges",
    timestamps: true,
    underscored: true,
    hooks: {
          beforeCreate: async (labelRange: CarrierLabelRange) => {
            if (labelRange.cep_start) {
              labelRange.cep_start = cleanCep(labelRange.cep_start)
            }

             if (labelRange.cep_end) {
              labelRange.cep_end = cleanCep(labelRange.cep_end)
            }
          },
          beforeUpdate: async (labelRange: CarrierLabelRange) => {
            if (labelRange.cep_start) {
              labelRange.cep_start = cleanCep(labelRange.cep_start)
            }

            if (labelRange.cep_end) {
              labelRange.cep_end = cleanCep(labelRange.cep_end)
            }
          },
        },
  },
);

export default CarrierLabelRange;
