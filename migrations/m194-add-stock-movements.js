'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'stock_movements',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'unit_businesses',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          product_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'products',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          invoice_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'invoices',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          invoice_number: {
            type: Sequelize.STRING(100),
            allowNull: true,
          },
          movement_type: {
            type: Sequelize.ENUM('PURCHASE_ENTRY', 'SALE_OUT', 'CUSTOMER_RETURN'),
            allowNull: false,
          },
          movement_date: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          movement_quantity: {
            type: Sequelize.DECIMAL(12, 4),
            allowNull: false,
          },
          unit_cost_invoice: {
            type: Sequelize.DECIMAL(12, 4),
            allowNull: true,
          },
          balance_quantity: {
            type: Sequelize.DECIMAL(12, 4),
            allowNull: false,
          },
          resulting_average_cost: {
            type: Sequelize.DECIMAL(12, 4),
            allowNull: false,
          },
          total_stock_value: {
            type: Sequelize.DECIMAL(12, 4),
            allowNull: false,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('stock_movements', ['product_id', 'movement_date'], {
        name: 'stock_movements_product_date_idx',
        transaction,
      });

      await queryInterface.addIndex('stock_movements', ['invoice_id', 'product_id'], {
        name: 'stock_movements_invoice_product_idx',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('stock_movements', { transaction });
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_stock_movements_movement_type";',
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};