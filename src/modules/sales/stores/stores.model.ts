import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { storeAttributes, storeCreationAttributes } from "./stores.types";
import { v4 as uuidv4 } from 'uuid';

class Store extends Model<storeAttributes, storeCreationAttributes> implements storeAttributes {
    public id!: string;
    public name!: string;
    public id_store_system!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Store.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: uuidv4,
            primaryKey: true,
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
         id_store_system: {
            type: DataTypes.STRING(255),
            allowNull: true
        }
    },
    {
        sequelize,
        tableName: 'stores',
        timestamps: true,
        underscored: true,
    }
)

export default Store;