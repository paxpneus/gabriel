'use strict';

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('invoices', 'external_id', { transaction });
      await queryInterface.removeColumn('products', 'eanTribut',   { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn('products', 'eanTribut',   { type: Sequelize.STRING(20),  allowNull: true }, { transaction });
      await queryInterface.addColumn('invoices', 'external_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};