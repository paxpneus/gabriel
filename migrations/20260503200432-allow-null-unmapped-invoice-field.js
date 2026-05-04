'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('unmapped_invoice_products', 'invoice_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'invoices',
        key: 'id',
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
    UPDATE unmapped_invoice_products
    SET invoice_id = gen_random_uuid()
    WHERE invoice_id IS NULL;
  `);

    await queryInterface.changeColumn('unmapped_invoice_products', 'invoice_id', {
      type: Sequelize.UUID,
      allowNull: false,
    });
  }
};