'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_requests_status"
      ADD VALUE IF NOT EXISTS 'SHIP_TODAY';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_requests_correction_origin_status"
      ADD VALUE IF NOT EXISTS 'SHIP_TODAY';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_request_histories_step"
      ADD VALUE IF NOT EXISTS 'SHIP_TODAY';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
