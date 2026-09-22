import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { PdvSalesRequestStatus } from "../sales-request/pdv-sales-request.types";
import {
  PdvSalesRequestHistoryAttributes,
  PdvSalesRequestHistoryCreationAttributes,
} from "./pdv-sales-request-history.types";

class PdvSalesRequestHistory
  extends Model<
    PdvSalesRequestHistoryAttributes,
    PdvSalesRequestHistoryCreationAttributes
  >
  implements PdvSalesRequestHistoryAttributes
{
  public id!: string;
  public pdv_sales_request_id!: string;
  public step!: PdvSalesRequestStatus;
  public description!: string;
  public date!: Date;
  public user_id!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PdvSalesRequestHistory.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    pdv_sales_request_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "pdv_sales_requests",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    // Reaproveita o MESMO enum de status da solicitação (import único de
    // PdvSalesRequestStatus) — é o "step sincronizado com o status" pedido,
    // nunca redefinido separadamente pra não divergir.
    step: {
      type: DataTypes.ENUM(...Object.values(PdvSalesRequestStatus)),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    sequelize,
    tableName: "pdv_sales_request_histories",
    timestamps: true,
    underscored: true,
  },
);

export default PdvSalesRequestHistory;
