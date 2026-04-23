'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {

      // =========================
      // INVENTORY_BATCHES
      // =========================
      await queryInterface.createTable(
        'inventory_batches',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          date: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          total_quantity_stock: {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true,
          },
          total_quantity_read: {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true,
          },
          number: {
            type: Sequelize.STRING,
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
        { transaction }
      );

      // =========================
      // INVENTORY_BATCH_ITEMS
      // =========================
      await queryInterface.createTable(
        'inventory_batch_items',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
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
          inventory_batch_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'inventory_batches',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          stock_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'stocks',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          ean: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          sku: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          quantity_stock: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
          },
          quantity_read: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
          },
          divergency: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
          },
          status: {
            type: Sequelize.ENUM('FINISHED', 'PENDING', 'OPEN'),
            defaultValue: 'OPEN',
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
        { transaction }
      );

      // =========================
      // INVENTORY_BATCH_LOGS
      // =========================
      await queryInterface.createTable(
        'inventory_batch_logs',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          user_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'users',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          inventory_batch_item_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'inventory_batch_items', 
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          quantity_read: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
          },
          label_code: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW,
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
        { transaction }
      );

      await transaction.commit();

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {

      await queryInterface.dropTable('inventory_batch_logs', { transaction });
      await queryInterface.dropTable('inventory_batch_items', { transaction });
      await queryInterface.dropTable('inventory_batches', { transaction });

      await transaction.commit();

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};