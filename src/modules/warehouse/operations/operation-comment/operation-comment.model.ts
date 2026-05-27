import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  OperationCommentAttributes,
  OperationCommentCreationAttributes,
} from "./operation-comment.types";
import { v4 as uuidv4 } from "uuid";

class OperationComment
  extends Model<OperationCommentAttributes, OperationCommentCreationAttributes>
  implements OperationCommentAttributes
{
  public id!: string;
  public userId!: string;
  public unitBusinessId!: string;
  public operationId!: string;
  public comment!: string;
  public pointTo?: string | null;
  public date!: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OperationComment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      field: "user_id",
    },
    unitBusinessId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
      field: "unit_business_id",
    },
    operationId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "operations",
        key: "id",
      },
      field: "operation_id",
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    pointTo: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "operation_comments",
        key: "id",
      },
      field: "point_to",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    underscored: true,
    tableName: "operation_comments",
    timestamps: true,
  }
);

export default OperationComment;
