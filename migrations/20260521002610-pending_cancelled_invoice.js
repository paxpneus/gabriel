'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_invoices_status ADD VALUE IF NOT EXISTS 'PENDING_CANCELLED_SYSTEM';
    `);
  },

  async down(queryInterface) {
    // Postgres não remove valores de enum — seria necessário recriar o tipo inteiro
    // Documentar como limitação ou fazer rollback manual
  }
};