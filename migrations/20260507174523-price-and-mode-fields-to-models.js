'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // =========================
      // inventory_batches
      // =========================
      await queryInterface.addColumn('inventory_batches', 'total_price', {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      }, { transaction });

      await queryInterface.addColumn('inventory_batches', 'mode', {
        type: Sequelize.ENUM('FIXED', 'CYCLIC'),
        allowNull: false,
        defaultValue: 'CYCLIC',
      }, { transaction });

      // =========================
      // products
      // =========================
      await queryInterface.addColumn('products', 'price', {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      }, { transaction });

      // =========================
      // inventory_batch_items
      // =========================
      await queryInterface.addColumn('inventory_batch_items', 'price', {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      }, { transaction });

      // =========================
      // stocks
      // =========================
      await queryInterface.addColumn('stocks', 'total_price', {
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
      await queryInterface.removeColumn('stocks', 'total_price', { transaction });
      await queryInterface.removeColumn('inventory_batch_items', 'price', { transaction });
      await queryInterface.removeColumn('products', 'price', { transaction });
      await queryInterface.removeColumn('inventory_batches', 'mode', { transaction });
      await queryInterface.removeColumn('inventory_batches', 'total_price', { transaction });

      // drop enum type for mode (Postgres)
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_inventory_batches_mode";`,
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};