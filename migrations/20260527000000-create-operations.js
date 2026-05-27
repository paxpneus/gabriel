'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'operations',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          description: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          date: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          due_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          expected_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          status: {
            type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED'),
            allowNull: false,
            defaultValue: 'OPEN',
          },
          invoice_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'invoices', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          from_unit: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          to_unit: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          transporter_name: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          total_quantity: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
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

      await queryInterface.createTable(
        'operations_itens',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          operation_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'operations', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          product_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          code: {
            type: Sequelize.STRING(100),
            allowNull: true,
          },
          quantity: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
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

      await queryInterface.addIndex('operations', ['status'], {
        name: 'idx_operations_status',
        transaction,
      });
      await queryInterface.addIndex('operations', ['invoice_id'], {
        name: 'idx_operations_invoice',
        transaction,
      });
      await queryInterface.addIndex('operations', ['from_unit'], {
        name: 'idx_operations_from_unit',
        transaction,
      });
      await queryInterface.addIndex('operations', ['to_unit'], {
        name: 'idx_operations_to_unit',
        transaction,
      });
      await queryInterface.addIndex('operations_itens', ['operation_id'], {
        name: 'idx_operations_itens_operation',
        transaction,
      });
      await queryInterface.addIndex('operations_itens', ['product_id'], {
        name: 'idx_operations_itens_product',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('operations_itens', { transaction });
      await queryInterface.dropTable('operations', { transaction });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_operations_status";', {
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
