import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { orderAttributes, orderCreationAttributes } from "./orders.types";
import { v4 as uuidv4 } from "uuid";

class Order
  extends Model<orderAttributes, orderCreationAttributes>
  implements orderAttributes
{
  public id!: string;
  public integration_id!: string;
  public customer_id!: string;
  public id_order_system?: string;
  public number_order_system!: string;
  public number_order_channel!: string;
  public actual_step!: string;
  public actual_situation!: string;
  public collection_date?: Date;
  public date?: Date;
  public totalPrice?: number;
  public nfe_emitted?: boolean;
  public internal_status?: string;
  public store_id?: string;
  public waiting_acceptance?: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Order.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    integration_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "integrations",
        key: "id",
      },
    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "customers",
        key: "id",
      },
    },
    store_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "stores",
        key: "id",
      }
    },
    id_order_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    number_order_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    number_order_channel: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    actual_step: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "PENDING",
    },
    actual_situation: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    collection_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    totalPrice: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    nfe_emitted: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    waiting_acceptance: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    internal_status: {
    type: DataTypes.ENUM(
        'OPEN', 
        'WAITING CHANNEL VALIDATION', 
        'WAITING FOR NFE EMISSION',
        'CANCELLED',
        'EMITTED'
    ),
    allowNull: false,
    defaultValue: 'OPEN',
    validate: {
        isIn: {
            args: [['OPEN', 'WAITING CHANNEL VALIDATION', 'WAITING FOR NFE EMISSION', 'CANCELLED', 'EMITTED']],
            msg: "O status fornecido não é permitido."
        }
    }
}
  },
  {
    sequelize,
    tableName: "orders",
    timestamps: true,
    underscored: true,
  },
);

export default Order;
