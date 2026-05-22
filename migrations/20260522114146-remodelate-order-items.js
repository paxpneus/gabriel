'use strict';

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('order_items', 'external_item_id',    { transaction });
      await queryInterface.removeColumn('order_items', 'external_product_id', { transaction });
      await queryInterface.removeColumn('order_items', 'source_system',       { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn('order_items', 'source_system',       { type: Sequelize.STRING(50),  allowNull: true }, { transaction });
      await queryInterface.addColumn('order_items', 'external_product_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('order_items', 'external_item_id',    { type: Sequelize.STRING(100), allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};