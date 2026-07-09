'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('seller_sales_order_item_snapshots', 'freight_cost_allocated', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });


  },

  async down(queryInterface) {

    await queryInterface.removeColumn('seller_sales_order_item_snapshots', 'freight_cost_allocated');
  },
};