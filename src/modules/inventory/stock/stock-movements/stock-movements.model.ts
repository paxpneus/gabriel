import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  StockDirectionType,
  StockMovementAttributes,
  StockMovementCreationAttributes,
  StockMovementStatus,
  StockMovementType,
} from "./stock-movements.types";
import { v4 as uuidv4 } from "uuid";

class StockMovement
  extends Model<StockMovementAttributes, StockMovementCreationAttributes>
  implements StockMovementAttributes
{
  public id!: string;
  public unit_business_id!: string;
  public product_id!: string;
  public invoice_id!: string | null;
  public invoice_number?: string;
  public direction?: StockDirectionType;
  public movement_type!: StockMovementType;
  public movement_date!: Date;
  public movement_quantity!: number;
  public unit_cost_invoice?: number;
  public balance_quantity!: number;
  public resulting_average_cost!: number;
  public total_stock_value!: number;
  public manual_average_cost_value?: number | null;
  public refers_to?: string | null;
  public gross_total_amount?: string | null;
  public net_total_amount?: string | null;
  public unit_discount_amount?: string | null;
  public discount_amount?: string | null;
  public discount_percentage?: string | null;
  public unit_price_invoice?: string | null;
  public bling_entry_ids?: string | null;
  public bling_origin_id?: string | null;
  public is_active!: boolean;
  public status!: StockMovementStatus;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StockMovement.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "products",
        key: "id",
      },
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "invoices",
        key: "id",
      },
    },
    invoice_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    movement_type: {
      type: DataTypes.ENUM(
        "PURCHASE_ENTRY",
        "SALE_OUT",
        "CUSTOMER_RETURN",
        "MANUAL_ADJUSTMENT",
      ),
      allowNull: false,
    },
    direction: {
      type: DataTypes.ENUM("IN", "OUT"),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "SYNCHED"),
      allowNull: false,
      defaultValue: "PENDING",
    },
    movement_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    movement_quantity: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    unit_cost_invoice: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
    },
    balance_quantity: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    resulting_average_cost: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    total_stock_value: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    manual_average_cost_value: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
      defaultValue: null,
    },
    refers_to: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    gross_total_amount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
    },
    net_total_amount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
    },
    unit_discount_amount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
    },
    discount_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    unit_price_invoice: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
    },
    bling_entry_ids: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    bling_origin_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "stock_movements",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ["product_id", "movement_date"],
        name: "stock_movements_product_date_idx",
      },
      {
        fields: ["invoice_id", "product_id"],
        name: "stock_movements_invoice_product_idx",
      },
    ],
  },
);

export default StockMovement;
