import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UnitBusinessGroupMemberAttributes,
  UnitBusinessGroupMemberCreationAttributes,
} from "./unit-business-group-member.types";
import { v4 as uuidv4 } from "uuid";

class UnitBusinessGroupMember
  extends Model<
    UnitBusinessGroupMemberAttributes,
    UnitBusinessGroupMemberCreationAttributes
  >
  implements UnitBusinessGroupMemberAttributes
{
  public id!: string;
  public unit_business_group_id!: string;
  public unit_business_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusinessGroupMember.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    unit_business_group_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "unit_business_groups", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "unit_businesses", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
  },
  {
    sequelize,
    tableName: "unit_business_group_members",
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ["unit_business_group_id", "unit_business_id"] },
      { fields: ["unit_business_id"] },
    ],
  },
);

export default UnitBusinessGroupMember;
