'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_orders_internal_status" ADD VALUE IF NOT EXISTS 'SENT_TO_TRANSPORTER';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_orders_internal_status" ADD VALUE IF NOT EXISTS 'DELIVERED';
    `);
  },

  async down(queryInterface) {
  }
};