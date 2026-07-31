'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "stock_movements"
      ALTER COLUMN "invoice_id" DROP NOT NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "stock_movements"
      ALTER COLUMN "invoice_id" SET NOT NULL;
    `);
  },
};