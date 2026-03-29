import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { configTokensAtributes, configTokensCreationAtributes } from "./config_tokens.types";
import { v4 as uuidv4 } from 'uuid';

class ConfigToken extends Model<configTokensAtributes, configTokensCreationAtributes> implements configTokensAtributes {
    public id!: string;
    public integrations_id!: string;
    public access_token!: string;
    public refresh_token!: string;
    public client_id!: string;
    public client_secret!: string;
    public access_token_url!: string;
    public auth_url!: string;
    public callback_url!: string;
    public oauth_state?: string | undefined;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

ConfigToken.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: uuidv4,
            primaryKey: true,
            allowNull: false,
        },
        integrations_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'integrations',
                key: 'id'
            }
        },
        access_token: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        refresh_token: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        client_id: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        client_secret: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        access_token_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        auth_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        oauth_state: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        callback_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
        }
    },
    {
        sequelize,
        tableName: 'config_tokens',
        timestamps: true,
        underscored: true,
    }
);

export default ConfigToken;