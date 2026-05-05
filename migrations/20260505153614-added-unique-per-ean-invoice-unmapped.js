'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addIndex('unmapped_invoice_products', ['ean'], {
      unique: true,
      where: {
        invoice_id: null
      },
      name: 'unique_ean_null_invoice'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex(
      'unmapped_invoice_products',
      'unique_ean_null_invoice'
    );
  }
};
