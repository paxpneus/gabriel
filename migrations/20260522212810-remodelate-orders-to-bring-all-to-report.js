'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'orders',
        'destination_uf',
        { type: Sequelize.STRING(2), allowNull: true },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'destination_city',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'icms_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'ipi_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'pis_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'cofins_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'difal_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'ibs_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'cbs_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await queryInterface.addColumn(
        'orders',
        'approx_tax_value',
        { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('orders', 'destination_uf', { transaction });
      await queryInterface.removeColumn('orders', 'destination_city', { transaction });
      await queryInterface.removeColumn('orders', 'icms_value', { transaction });
      await queryInterface.removeColumn('orders', 'ipi_value', { transaction });
      await queryInterface.removeColumn('orders', 'pis_value', { transaction });
      await queryInterface.removeColumn('orders', 'cofins_value', { transaction });
      await queryInterface.removeColumn('orders', 'difal_value', { transaction });
      await queryInterface.removeColumn('orders', 'ibs_value', { transaction });
      await queryInterface.removeColumn('orders', 'cbs_value', { transaction });
      await queryInterface.removeColumn('orders', 'approx_tax_value', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};