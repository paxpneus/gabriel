import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { customerAttributes, customerCreationAttributes, userType } from "./customers.types";
import { v4 as uuidv4 } from 'uuid';

import { normalizeDocument } from "../../../shared/utils/normalizers/document";

class Customer extends Model<customerAttributes, customerCreationAttributes> implements customerAttributes {
    public id!: string;
    public name!: string;
    public type!: userType;
    public document!: number;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Customer.init(
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
            type: DataTypes.ENUM('P', 'J'),
            allowNull: false,
        },
        document: {
            type: DataTypes.STRING(14), 
            allowNull: false,
            unique: true 
        }
    },
    {
        sequelize,
        tableName: 'customers',
        timestamps: true,
        underscored: true
    }
);

Customer.beforeCreate((customer) => normalizeDocument(customer))
Customer.beforeUpdate((customer) => normalizeDocument(customer))

export default Customer;