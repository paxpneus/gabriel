'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'reason_cancelled', {
      type: Sequelize.ENUM(
        'DOCUMENT_INVALID',
        'CNAE_BLOCKED',
        'NFE_WRONG_STATUS',
        'NFE_MISSING_FIELDS',
        'NFE_NO_STOCK',
        'NFE_EMISSION_FAILED',
        'ML_SCRAPING_NO_MATCH',
        'CUSTOMER_CANCELLED',
      ),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'reason_cancelled');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_orders_reason_cancelled";',
    );
  },
};
