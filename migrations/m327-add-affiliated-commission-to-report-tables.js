'use strict';

// Comissão do afiliado (order_coupons) nos snapshots/facts dos relatórios; sem backfill, só após reprocessar os pedidos.
const COLUMNS = [
  ['sales_order_snapshots', 'affiliated_id', (S) => ({ type: S.UUID, allowNull: true })],
  ['sales_order_snapshots', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['sales_order_item_snapshots', 'affiliated_commission_value', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['seller_sales_order_item_snapshots', 'affiliated_id', (S) => ({ type: S.UUID, allowNull: true })],
  ['seller_sales_order_item_snapshots', 'affiliated_commission_value', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['daily_sales_facts', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['daily_sales_store_facts', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['daily_sales_product_facts', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['daily_seller_product_facts', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
  ['daily_seller_customer_facts', 'total_affiliated_commission', (S) => ({ type: S.DECIMAL(14, 2), allowNull: true, defaultValue: 0 })],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, column, definition] of COLUMNS) {
        await queryInterface.addColumn(table, column, definition(Sequelize), { transaction });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, column] of [...COLUMNS].reverse()) {
        await queryInterface.removeColumn(table, column, { transaction });
      }
    });
  },
};
