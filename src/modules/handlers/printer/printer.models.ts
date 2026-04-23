import { Model, DataTypes } from 'sequelize'
import sequelize from '../../../config/sequelize'
import { PrinterConfigAttributes, PrinterConfigCreationAttributes } from './printer.types'
import { v4 as uuidv4 } from 'uuid'

class PrinterConfig extends Model<PrinterConfigAttributes, PrinterConfigCreationAttributes>
  implements PrinterConfigAttributes {
  public id!: string
  public unit_business_id!: string
  public server_ip!: string
  public printer_name!: string
  public is_active!: boolean
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

PrinterConfig.init(
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
      references: { model: 'unit_businesses', key: 'id' },
    },
    server_ip: {
      type: DataTypes.STRING(45),
      allowNull: false,
    },
    printer_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'printer_configs',
    timestamps: true,
    underscored: true,
  }
)

export default PrinterConfig