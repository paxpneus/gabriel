'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoice_unit_business_attributes', 'purpose', {
      type: Sequelize.ENUM('REGULAR', 'TRANSSHIPMENT'),
      allowNull: false,
      defaultValue: 'REGULAR',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoice_unit_business_attributes', 'purpose');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_invoice_unit_business_attributes_purpose";');
  },
};
