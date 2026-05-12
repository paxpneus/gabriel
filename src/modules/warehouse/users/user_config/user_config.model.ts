import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UserConfigAttributes,
  UserConfigCreationAttributes,
  UserTheme,
} from "./user_config.types";
import { v4 as uuidv4 } from "uuid";

class UserConfig
  extends Model<UserConfigAttributes, UserConfigCreationAttributes>
  implements UserConfigAttributes
{
  public id!: string;
  public user_id!: string;
  public theme!: UserTheme;
  public profile_photo?: string;
  public language!: string;
  public timezone!: string;
  public items_per_page!: number;
  public notifications_enabled!: boolean;
  public compact_mode!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserConfig.init(
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
      unique: true,
      references: {
        model: "users",
        key: "id",
      },
    },
    theme: {
      type: DataTypes.ENUM("dark", "light"),
      allowNull: false,
      defaultValue: "light",
    },
    profile_photo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    language: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "pt-BR",
    },
    timezone: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: "America/Sao_Paulo",
    },
    items_per_page: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20,
    },
    notifications_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    compact_mode: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "user_config",
    timestamps: true,
    underscored: true,
  },
);

export default UserConfig;
