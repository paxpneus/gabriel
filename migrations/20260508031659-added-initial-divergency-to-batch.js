'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // =========================
      // inventory_batch_items
      // =========================
      await queryInterface.addColumn('inventory_batch_items', 'initial_divergency', {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // reverse order
      await queryInterface.removeColumn('inventory_batch_items', 'initial_divergency', { transaction });
  

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};