'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint('invoice_items', {
      fields: ['invoice_id', 'product_id'],
      type: 'unique',
      name: 'uq_invoice_items_invoice_product',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('invoice_items', 'uq_invoice_items_invoice_product');
  },
};