'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_order_snapshots', 'total_commission', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });

    await queryInterface.addColumn('daily_sales_facts', 'total_commission', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });

    await queryInterface.addColumn('daily_sales_store_facts', 'total_commission', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });

    await queryInterface.addColumn('daily_sales_product_facts', 'total_commission', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_sales_product_facts', 'total_commission');
    await queryInterface.removeColumn('daily_sales_store_facts', 'total_commission');
    await queryInterface.removeColumn('daily_sales_facts', 'total_commission');
    await queryInterface.removeColumn('sales_order_snapshots', 'total_commission');
  },
};