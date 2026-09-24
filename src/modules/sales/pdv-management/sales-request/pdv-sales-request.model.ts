import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  PdvSalesRequestAttributes,
  PdvSalesRequestCreationAttributes,
  PdvSalesRequestErrors,
  PdvShippingType,
  PdvSalesRequestStatus,
  PaymentReceiptReconciledAnalysis,
} from "./pdv-sales-request.types";

class PdvSalesRequest
  extends Model<PdvSalesRequestAttributes, PdvSalesRequestCreationAttributes>
  implements PdvSalesRequestAttributes
{
  public id!: string;
  public order_id!: string;
  public unit_business_id!: string | null;
  public sale_invoice_id!: string | null;
  public transfer_invoice_id!: string | null;
  public status!: PdvSalesRequestStatus;
  public correction_origin_status!: PdvSalesRequestStatus | null;
  public shipping_type!: PdvShippingType | null;
  public name!: string;
  public payment_receipt_analysis!: PaymentReceiptReconciledAnalysis | null;
  public payment_receipt_validated!: boolean | null;
  public payment_method_matches_receipt!: boolean | null;
  public receipt_total_matches_order!: boolean | null;
  public errors!: PdvSalesRequestErrors | null;
  public created_by_user_id!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PdvSalesRequest.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    // Sem unique — uma mesma order pode ter mais de uma solicitação ao
    // longo do tempo (ex.: depois de CANCELLED/INVOICE_CANCELLED). Quem
    // impede duas solicitações ATIVAS pro mesmo pedido é o service
    // (findActiveByOrderId), não uma constraint de banco.
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "orders",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    // Espelhado automaticamente de order.unit_business_id pelo service —
    // nunca setado via API.
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "unit_businesses",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    // Espelhado automaticamente de order.invoice_id pelo service — nunca
    // setado via API.
    sale_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "invoices",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    // Só relevante quando shipping_type = ADT.
    transfer_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "invoices",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    status: {
      type: DataTypes.ENUM(...Object.values(PdvSalesRequestStatus)),
      allowNull: false,
      defaultValue: PdvSalesRequestStatus.OPEN,
    },
    correction_origin_status: {
      type: DataTypes.ENUM(...Object.values(PdvSalesRequestStatus)),
      allowNull: true,
    },
    shipping_type: {
      type: DataTypes.ENUM(...Object.values(PdvShippingType)),
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    // Conciliação de todos os PdvSalesRequestReceipt anexados no momento —
    // ver PaymentReceiptReconciledAnalysis/reconcileReceipts. Nunca a
    // extração de um comprovante só (essa fica em
    // pdv_sales_request_receipts.analysis).
    payment_receipt_analysis: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    // AND lógico do `validated` de cada comprovante anexado (ver
    // reconcileReceiptValidation) — null quando nenhum comprovante tem
    // validação aplicável (ex.: só PIX).
    payment_receipt_validated: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    // Comparação forma de pagamento (Bling) x tipo_comprovante extraído — só
    // calculada com exatamente 1 comprovante anexado (ver reconcileReceipts).
    payment_method_matches_receipt: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    // Comparação payment_receipt_analysis.valor_total (soma conciliada) x
    // order.total_order — só informativo pro front mostrar aviso, nunca
    // bloqueia nenhuma transição (ver reconcileReceipts/
    // updatePaymentReceiptAnalysis). null quando não dá pra comparar (sem
    // comprovante com valor ainda, ou sem total do pedido).
    receipt_total_matches_order: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    errors: {
      type: DataTypes.JSONB,
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
    tableName: "pdv_sales_requests",
    timestamps: true,
    underscored: true,
  },
);

export default PdvSalesRequest;
