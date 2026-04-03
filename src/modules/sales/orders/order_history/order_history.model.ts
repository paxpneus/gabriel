import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { orderHistoryAttributes, orderHistoryCreationAttributes, resultTypes } from "./order_history.types";
import { v4 as uuidv4 } from 'uuid';

class OrderHistory extends Model<orderHistoryAttributes, orderHistoryCreationAttributes> implements orderHistoryAttributes {
    public id!: string;
    public order_id!: string; 
    public step_id!: string;
    public situation!: string;
    public date!: Date;
    public json_data!: any;
    public result!: resultTypes;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

OrderHistory.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: uuidv4,
            primaryKey: true,
            allowNull: false,
        },
        order_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'orders',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
        },
        step_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'steps',
                key: 'id'
            }
        },
        situation: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        json_data: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        result: {
            type: DataTypes.ENUM('success', 'errors', 'processing'),
            allowNull: false,
            defaultValue: 'processing'
        }
    },
    {
        sequelize,
        tableName: 'order_histories',
        timestamps: true,
        underscored: true
    }
);

export default OrderHistory;