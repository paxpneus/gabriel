'use strict';

const money = (Sequelize) => ({ type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 });

const COLUMNS = (Sequelize) => [
  ['sales_order_snapshots', 'affiliated_id', { type: Sequelize.UUID, allowNull: true }],
  ['sales_order_snapshots', 'total_affiliated_commission', money(Sequelize)],
  ['sales_order_item_snapshots', 'affiliated_commission_value', money(Sequelize)],
  ['seller_sales_order_item_snapshots', 'affiliated_id', { type: Sequelize.UUID, allowNull: true }],
  ['seller_sales_order_item_snapshots', 'affiliated_commission_value', money(Sequelize)],
  ['daily_sales_facts', 'total_affiliated_commission', money(Sequelize)],
  ['daily_sales_store_facts', 'total_affiliated_commission', money(Sequelize)],
  ['daily_sales_product_facts', 'total_affiliated_commission', money(Sequelize)],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      for (const [table, column, definition] of COLUMNS(Sequelize)) {
        await queryInterface.addColumn(table, column, definition, { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    for (const [table, column] of COLUMNS(Sequelize).reverse()) {
      await queryInterface.removeColumn(table, column);
    }
  },
};
