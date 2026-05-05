'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_invoices_status ADD VALUE IF NOT EXISTS 'FREE_TO_SCHEDULE';
      ALTER TYPE enum_invoices_status ADD VALUE IF NOT EXISTS 'WAITING_SCHEDULE_SALES';
      ALTER TYPE enum_invoices_status ADD VALUE IF NOT EXISTS 'SCHEDULED';
      ALTER TYPE enum_invoices_status ADD VALUE IF NOT EXISTS 'LATE';
    `);
  },

  async down(queryInterface) {
    // Postgres não remove valores de enum — seria necessário recriar o tipo inteiro
    // Documentar como limitação ou fazer rollback manual
  }
};