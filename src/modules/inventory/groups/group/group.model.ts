import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  GroupAttributes,
  GroupCreationAttributes,
  GroupType,
} from "./group.types";

class Group
  extends Model<GroupAttributes, GroupCreationAttributes>
  implements GroupAttributes
{
  public id!: string;
  public name!: string;
  public type!: GroupType;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Group.init(
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
    type: {
      type: DataTypes.ENUM(GroupType.PRODUCTS),
      allowNull: false,
      defaultValue: GroupType.PRODUCTS,
    },
  },
  {
    sequelize,
    tableName: "groups",
    timestamps: true,
    underscored: true,
  },
);

export default Group;
