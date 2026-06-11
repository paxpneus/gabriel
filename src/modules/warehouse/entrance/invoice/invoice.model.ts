import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  InvoiceAttributes,
  InvoiceCreationAttributes,
  SefazManifestationStatus,
} from "./invoice.types";
import { v4 as uuidv4 } from "uuid";
import { ExpeditionBatchInvoiceAttributes } from "../../expedition/batch-invoices/batch-invoices.types";

class Invoice
  extends Model<InvoiceAttributes, InvoiceCreationAttributes>
  implements InvoiceAttributes
{
  public id!: string;
  public customer_name!: string;
  public customer_document!: string;
  public xml_path?: string;
  public danfe_path?: string;
  public unit_business_id!: string;
  public store_id!: string;
  public sender_cnpj!: string;
  public sender_name!: string;
  public receiver_cnpj!: string;
  public receiver_name!: string;
  public integrations_id?: string;
  public id_system?: string;
  public transporter_id?: string;
  public seller_id?: string | null;
  public type!: "INCOMING" | "OUTGOING";
  public status!:
    | "OPEN"
    | "PENDING"
    | "FINISHED"
    | "CANCELLED"
    | "FREE_TO_SCHEDULE"
    | "WAITING_SCHEDULE_SALES"
    | "SCHEDULED"
    | "LATE"
    | "PENDING_CANCELLED_SYSTEM";
  public batch_generated!: boolean;
  public printed_label!: boolean;
  public emitted_at?: Date;
  public received_at?: string;
  public expected_receiving?: string;
  public number_system?: string;
  public xml_key?: string;
  public transporter_name?: string;
  public transporter_document?: string;
  public total_read!: number;
  public total_expected!: number;
  public description?: string;
  public bonded_invoice?: string;
  public invoice_series?: string | null;
  public invoice_value?: number;
  public invoice_products_value?: number;
  public invoice_freight_value?: number;
  public invoice_discount_value?: number;
  public invoice_other_value?: number;
  public invoice_total_tax_value?: number;
  public icms_value?: number;
  public ipi_value?: number;
  public pis_value?: number;
  public cofins_value?: number;
  public difal_value?: number;
  public ibs_value?: number;
  public cbs_value?: number;
  public destination_uf?: string | null;
  public destination_city?: string | null;
  public xml_url?: string | null;
  public source_payload?: Record<string, unknown> | null;
  public sefaz_manifestation_status?: SefazManifestationStatus | null;
  public sefaz_n_seq_evento!: number;
  public sefaz_nsu?: string | null;

  public batchInvoice?: ExpeditionBatchInvoiceAttributes;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Invoice.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    customer_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    customer_document: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    bonded_invoice: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    xml_path: {
      type: DataTypes.TEXT,
    },
    xml_key: {
      type: DataTypes.STRING(255),
      unique: true,
      allowNull: true,
    },
    danfe_path: {
      type: DataTypes.TEXT,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "stores",
        key: "id",
      },
    },
    sender_cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    sender_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    receiver_cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    receiver_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      references: {
        model: "integrations",
        key: "id",
      },
    },
    id_system: {
      type: DataTypes.STRING(100),
      unique: true,
    },
    transporter_id: {
      type: DataTypes.UUID,
      references: {
        model: "transporters",
        key: "id",
      },
    },
    seller_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "contacts",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    transporter_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    transporter_document: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("INCOMING", "OUTGOING"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(
        "OPEN",
        "PENDING",
        "FINISHED",
        "FREE_TO_SCHEDULE",
        "WAITING_SCHEDULE_SALES",
        "SCHEDULED",
        "LATE",
        "CANCELLED",
        "PENDING_CANCELLED_SYSTEM",
      ),
      defaultValue: "PENDING",
      allowNull: false,
    },
    batch_generated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    printed_label: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    emitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    received_at: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    expected_receiving: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    number_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    total_read: {
      type: DataTypes.VIRTUAL,
      allowNull: true,
    },
    total_expected: {
      type: DataTypes.VIRTUAL,
      allowNull: true,
    },
    invoice_series: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    invoice_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    invoice_products_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    invoice_freight_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    invoice_discount_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    invoice_other_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    invoice_total_tax_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    icms_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    ipi_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    pis_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    cofins_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    difal_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    ibs_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    cbs_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    destination_uf: {
      type: DataTypes.STRING(2),
      allowNull: true,
    },
    destination_city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    xml_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    source_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    sefaz_manifestation_status: {
      type: DataTypes.ENUM(
        "PENDING_CIENCIA",
        "CIENCIA_ENVIADA",
        "CIENCIA_REJEITADA",
        "CONFIRMADO",
        "DESCONHECIDO",
        "OPERACAO_NAO_REALIZADA",
      ),
      allowNull: true,
      defaultValue: null,
    },
    sefaz_n_seq_evento: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    sefaz_nsu: {
      type: DataTypes.STRING(15),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "invoices",
    timestamps: true,
    underscored: true,
  },
);

export default Invoice;
