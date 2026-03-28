import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { stepAttributes, stepCreationAttributes } from "./steps.types";
import { v4 as uuidv4 } from 'uuid';

class Step extends Model<stepAttributes, stepCreationAttributes> implements stepAttributes {
    public id!: string;
    public label_admin!: string;
    public label_system!: string;
    public sequence!: number;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Step.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: uuidv4,
            primaryKey: true,
            allowNull: false,
        },
        label_admin: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        label_system: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        sequence: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        }
    },
    {
        sequelize,
        tableName: 'steps',
        timestamps: true,
        underscored: true
    }
);

export default Step;