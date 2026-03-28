import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { integrationsAttributes, integrationsCreationAttributes, integrationsType } from "./integrations.types";
import { v4 as uuidv4 } from 'uuid';

class Integration extends Model<integrationsAttributes, integrationsCreationAttributes> implements integrationsAttributes {
    public id!: string;
    public name!: string;
    public type!: integrationsType;
    public api_url!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Integration.init(
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
            type: DataTypes.ENUM('CHANNEL', 'SYSTEM'),
            allowNull: false,
        },
        api_url: {
            type: DataTypes.STRING(255),
            allowNull: false,
            validate: {
                isUrl: true
            }
        }
    },
    {
        sequelize,
        tableName: 'integrations',
        timestamps: true,
        underscored: true
    }
);

export default Integration;