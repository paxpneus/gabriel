import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { PaymentReceiptExtraction } from "../sales-request/pdv-sales-request.types";
import {
  PdvSalesRequestReceiptAttributes,
  PdvSalesRequestReceiptCreationAttributes,
} from "./pdv-sales-request-receipt.types";

class PdvSalesRequestReceipt
  extends Model<
    PdvSalesRequestReceiptAttributes,
    PdvSalesRequestReceiptCreationAttributes
  >
  implements PdvSalesRequestReceiptAttributes
{
  public id!: string;
  public pdv_sales_request_id!: string;
  public path!: string;
  public analysis!: PaymentReceiptExtraction | null;
  public validated!: boolean | null;
  public fingerprint!: string | null;
  public created_by_user_id!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PdvSalesRequestReceipt.init(
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
    path: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    analysis: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    // Validação matemática (qtd_parcelas * valor_parcela ≈ valor_total) —
    // null quando não aplicável (ex.: PIX, débito à vista).
    validated: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    // Chave de duplicidade — sha256(cnpj|data|hora|valor_total|instrumento).
    // Unique parcial (WHERE NOT NULL) na migration, global entre TODAS as
    // solicitações (não só dentro da mesma).
    fingerprint: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    created_by_user_id: {
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
    tableName: "pdv_sales_request_receipts",
    timestamps: true,
    underscored: true,
  },
);

export default PdvSalesRequestReceipt;
