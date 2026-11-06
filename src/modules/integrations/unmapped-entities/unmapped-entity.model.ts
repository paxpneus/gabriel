import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { ENTITY_TYPES, EntityType } from "../integration-mapping/integration-mapping.types";
import {
  UnmappedEntityAttributes,
  UnmappedEntityCreationAttributes,
} from "./unmapped-entity.types";

class UnmappedEntity
  extends Model<UnmappedEntityAttributes, UnmappedEntityCreationAttributes>
  implements UnmappedEntityAttributes
{
  public id!: string;
  public entity!: EntityType;
  public external_id!: string;
  public integrations_id!: string;
  public description!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnmappedEntity.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    // String (não ENUM) pra entidade nova não exigir ALTER TYPE; validado contra ENTITY_TYPES.
    entity: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: { isIn: [ENTITY_TYPES as unknown as string[]] },
    },
    external_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "integrations", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    // Nome que a integração dá ao valor (ex.: "Rede - Crédito Master 2x").
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "unmapped_entities",
    timestamps: true,
    underscored: true,
  },
);

export default UnmappedEntity;
