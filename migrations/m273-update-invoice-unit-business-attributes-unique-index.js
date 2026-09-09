'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex(
      'invoice_unit_business_attributes',
      'uq_invoice_unit_business_attributes_invoice_unit_business',
    );
    await queryInterface.addIndex(
      'invoice_unit_business_attributes',
      ['invoice_id', 'unit_business_id', 'type', 'purpose'],
      { unique: true, name: 'uq_invoice_unit_business_attributes_invoice_unit_business' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'invoice_unit_business_attributes',
      'uq_invoice_unit_business_attributes_invoice_unit_business',
    );
    await queryInterface.addIndex(
      'invoice_unit_business_attributes',
      ['invoice_id', 'unit_business_id'],
      { unique: true, name: 'uq_invoice_unit_business_attributes_invoice_unit_business' },
    );
  },
};
