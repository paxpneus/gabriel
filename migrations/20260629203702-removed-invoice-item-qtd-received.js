'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoice_items
        DROP COLUMN IF EXISTS quantity_received;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoice_items', 'quantity_received', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    });

  },
};