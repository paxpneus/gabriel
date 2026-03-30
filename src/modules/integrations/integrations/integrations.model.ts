import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { integrationsAttributes, integrationsCreationAttributes, integrationsType } from "./integrations.types";
import { v4 as uuidv4 } from 'uuid';
import { normalizeDocument } from "../../../shared/utils/normalizers/document";

class Integration extends Model<integrationsAttributes, integrationsCreationAttributes> implements integrationsAttributes {
    public id!: string;
    public name!: string;
    public type!: integrationsType;
    public api_url!: string;
    public cnaes!: string[];
    public document!: string;

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
        },
        document: {
            type: DataTypes.STRING(11),
            allowNull: true,
        },
        cnaes: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: true,
        }
    },
    {
        sequelize,
        tableName: 'integrations',
        timestamps: true,
        underscored: true
    }
);

Integration.beforeCreate((integration) => normalizeDocument(integration))
Integration.beforeUpdate((integration) => normalizeDocument(integration))

export default Integration;