'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint('invoices', {
      fields: ['xml_key'],
      type: 'unique',
      name: 'invoices_xml_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('invoices', 'invoices_xml_key');
  },
};
