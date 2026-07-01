'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.renameColumn(
      'batch_invoice_items',
      'quantity_received',
      'quantity_read',
    );
  },

  async down(queryInterface) {
    await queryInterface.renameColumn(
      'batch_invoice_items',
      'quantity_read',
      'quantity_received',
    );
  },
};