'use strict';

const COLUMNS = [
  'gross_total_amount',
  'net_total_amount',
  'unit_discount_amount',
  'discount_amount',
  'discount_percentage',
  'unit_price_invoice',
  'bling_entry_ids',
  'bling_origin_id',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'stock_movements';
    const existing = await queryInterface.describeTable(table);

    const definitions = {
      gross_total_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      net_total_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      unit_discount_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      discount_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      discount_percentage: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      unit_price_invoice: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      bling_entry_ids: { type: Sequelize.STRING(255), allowNull: true },
      bling_origin_id: { type: Sequelize.STRING(50), allowNull: true },
    };

    for (const column of COLUMNS) {
      if (existing[column]) continue;
      await queryInterface.addColumn(table, column, definitions[column]);
    }
  },

  async down(queryInterface) {
    const table = 'stock_movements';
    const existing = await queryInterface.describeTable(table);

    for (const column of [...COLUMNS].reverse()) {
      if (!existing[column]) continue;
      await queryInterface.removeColumn(table, column);
    }
  },
};
