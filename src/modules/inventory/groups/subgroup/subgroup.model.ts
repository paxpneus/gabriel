import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SubgroupAttributes,
  SubgroupCreationAttributes,
} from "./subgroup.types";

class Subgroup
  extends Model<SubgroupAttributes, SubgroupCreationAttributes>
  implements SubgroupAttributes
{
  public id!: string;
  public name!: string;
  public group_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Subgroup.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
  },
  {
    sequelize,
    tableName: "subgroups",
    timestamps: true,
    underscored: true,
  },
);

export default Subgroup;
