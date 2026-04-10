'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_orders_internal_status" ADD VALUE IF NOT EXISTS 'UNKNOWN';
    `);
  },

  async down(queryInterface, Sequelize) {
    // ENUM values não podem ser removidos no PostgreSQL facilmente
    // deixa vazio ou documenta que precisa recriar o tipo manualmente
  }
};