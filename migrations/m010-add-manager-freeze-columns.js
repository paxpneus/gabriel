'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('seller_sales_order_item_snapshots', 'manager_commission_rate', {
      type: Sequelize.DECIMAL(8, 4),
      allowNull: true,
      defaultValue: 0,
    });

    await queryInterface.addColumn('seller_sales_order_item_snapshots', 'manager_commission_value', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('seller_sales_order_item_snapshots', 'manager_commission_value');
    await queryInterface.removeColumn('seller_sales_order_item_snapshots', 'manager_commission_rate');
  },
};