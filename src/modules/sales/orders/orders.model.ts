import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { orderAttributes, orderCreationAttributes } from "./orders.types";
import { v4 as uuidv4 } from 'uuid';

class Order extends Model<orderAttributes, orderCreationAttributes> implements orderAttributes {
    public id!: string;
    public integration_id!: string;
    public customer_id!: string;
    public id_order_system?: string;
    public number_order_system!: string;
    public number_order_channel!: string;
    public actual_step!: string;
    public actual_situation!: string;
    public collection_date?: Date;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Order.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: uuidv4,
            primaryKey: true,
            allowNull: false,
        },
        integration_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'integrations',
                key: 'id'
            }
        },
        customer_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'customers',
                key: 'id'
            }
        },
        id_order_system: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        number_order_system: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        number_order_channel: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        actual_step: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'PENDING'
        },
        actual_situation: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'ACTIVE'
        },
        collection_date: {
            type: DataTypes.DATE,
            allowNull: true,
        }
    },
    {
        sequelize,
        tableName: 'orders',
        timestamps: true,
        underscored: true
    }
);

export default Order;