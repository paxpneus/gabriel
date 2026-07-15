import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UserUnitBusinessAttributes,
  UserUnitBusinessCreationAttributes,
} from "./user_unit_business.types";
import { v4 as uuidv4 } from "uuid";

class UserUnitBusiness
  extends Model<UserUnitBusinessAttributes, UserUnitBusinessCreationAttributes>
  implements UserUnitBusinessAttributes
{
  public id!: string;
  public user_id!: string;
  public unit_business_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserUnitBusiness.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
  },
  {
    sequelize,
    tableName: "user_unit_business",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["user_id", "unit_business_id"],
      },
    ],
  },
);

export default UserUnitBusiness;
