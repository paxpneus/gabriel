'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Remove campos redundantes/renomeados
      await queryInterface.removeColumn('orders', 'external_id', { transaction });
      await queryInterface.removeColumn('orders', 'external_number', { transaction });
      await queryInterface.removeColumn('orders', 'external_status_id', { transaction });
      await queryInterface.removeColumn('orders', 'external_store_order_number', { transaction });
      await queryInterface.removeColumn('orders', 'external_store_id', { transaction });
      await queryInterface.removeColumn('orders', 'external_status_name', { transaction });
      await queryInterface.removeColumn('orders', 'source_system', { transaction });

      // Remove a coluna antiga
      await queryInterface.removeColumn('orders', 'external_unit_business_id', { transaction });

      // Adiciona a nova já com o tipo e FK corretos
      await queryInterface.addColumn(
        'orders',
        'unit_business_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        { transaction }
      );

      // Remove a coluna antiga
      await queryInterface.removeColumn('orders', 'external_invoice_id', { transaction });

      // Adiciona a nova já com o tipo e FK corretos
      await queryInterface.addColumn(
        'orders',
        'invoice_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'invoices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Reverte invoice_id -> external_invoice_id (remove FK antes)
      await queryInterface.removeColumn('orders', 'invoice_id', { transaction });
      await queryInterface.removeColumn('orders', 'unit_business_id', { transaction });

      await queryInterface.addColumn('orders', 'external_invoice_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_unit_business_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });

      // Restaura colunas removidas
      await queryInterface.addColumn('orders', 'source_system', { type: Sequelize.STRING(50), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_status_name', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_store_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_store_order_number', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_status_id', { type: Sequelize.STRING(50), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_number', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('orders', 'external_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};