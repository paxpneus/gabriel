import { Model, DataTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../config/sequelize";
import {
  ApplicationAttributes,
  ApplicationCreationAttributes,
} from "./applications.types";
import Role from "../../warehouse/users/roles/role.model";

class Application
  extends Model<ApplicationAttributes, ApplicationCreationAttributes>
  implements ApplicationAttributes
{
  public id!: string;
  public name!: string;
  public description?: string | null;
  public role_id!: string;
  public api_key!: string;
  public api_secret_hash!: string;
  public allowed_routes!: string[];
  public rate_limit_max_requests!: number;
  public rate_limit_window_seconds!: number;
  public token_version!: number;
  public last_login_at?: Date | null;
  public revoked_at?: Date | null;
  public is_active!: boolean;
  public role?: Role;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Application.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "roles",
        key: "id",
      },
    },
    api_key: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
    },
    api_secret_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    allowed_routes: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: false,
      defaultValue: [],
    },
    rate_limit_max_requests: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 120,
      validate: {
        min: 1,
      },
    },
    rate_limit_window_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60,
      validate: {
        min: 1,
      },
    },
    token_version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "applications",
    timestamps: true,
    underscored: true,
  },
);

export default Application;

