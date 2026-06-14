'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_invoices_sefaz_manifestation_status"
      ADD VALUE IF NOT EXISTS 'AGUARDANDO_PROCNFE';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_invoices_sefaz_manifestation_status"
      ADD VALUE IF NOT EXISTS 'PROCNFE_DESISTIDO';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};