'use strict';

// CRITICAL_ERROR: NF de transferência confirmada com aviso crítico (PDV).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_requests_status"
      ADD VALUE IF NOT EXISTS 'CRITICAL_ERROR';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_requests_correction_origin_status"
      ADD VALUE IF NOT EXISTS 'CRITICAL_ERROR';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_pdv_sales_request_histories_step"
      ADD VALUE IF NOT EXISTS 'CRITICAL_ERROR';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
