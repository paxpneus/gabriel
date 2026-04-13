import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { IntegrationMappingAttributes, IntegrationMappingCreationAttributes, EntityType } from './integration-mapping.types';
import { v4 as uuidv4 } from 'uuid';

class IntegrationMapping extends Model<IntegrationMappingAttributes, IntegrationMappingCreationAttributes> implements IntegrationMappingAttributes {
  public id!: string;
  public entity_type!: EntityType;
  public internal_id!: string;
  public integration_id!: string;
  public external_id!: string;
  public unit_business_id!: string;

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
      type: DataTypes.ENUM('PRODUCT', 'INVOICE'),
      allowNull: false,
    },
    internal_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integration_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    external_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
  },
  {
    sequelize,
    tableName: 'integration_mappings',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['entity_type', 'internal_id', 'integration_id', 'unit_business_id'],
      },
    ],
  }
);

export default IntegrationMapping;
