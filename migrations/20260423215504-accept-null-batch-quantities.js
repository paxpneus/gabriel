'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('inventory_batches', 'total_quantity_stock', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
      allowNull: true,
    });

     await queryInterface.changeColumn('inventory_batches', 'total_quantity_read', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('inventory_batches', 'total_quantity_stock', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
      allowNull: false,
    });

      await queryInterface.changeColumn('inventory_batches', 'total_quantity_read', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
      allowNull: false,
    });
  }
};
