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
  public user_id!: string;
  public unit_business_id!: string;
  public operation_id!: string;
  public comment!: string;
  public point_to?: string | null;
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
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    operation_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "operations",
        key: "id",
      },
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    point_to: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "operation_comments",
        key: "id",
      },
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
