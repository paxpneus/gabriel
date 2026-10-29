import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  IntegrationMappingAttributes,
  IntegrationMappingCreationAttributes,
  EntityType,
  ENTITY_TYPES,
  ProductErpData,
} from "./integration-mapping.types";
import { v4 as uuidv4 } from "uuid";

class IntegrationMapping
  extends Model<
    IntegrationMappingAttributes,
    IntegrationMappingCreationAttributes
  >
  implements IntegrationMappingAttributes
{
  public id!: string;
  public entity_type!: EntityType;
  public internal_id!: string;
  public integrations_id!: string;
  public external_id!: string;
  public unit_business_id!: string;
  public is_primary!: boolean;
  public erp_data!: ProductErpData | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

IntegrationMapping.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    entity_type: {
      type: DataTypes.ENUM(...ENTITY_TYPES),
      allowNull: false,
    },
    internal_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      references: {
        model: "integrations",
        key: "id",
      },
    },
    external_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    erp_data: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "integration_mappings",
    timestamps: true,
    underscored: true,
   
  },
);

export default IntegrationMapping;
