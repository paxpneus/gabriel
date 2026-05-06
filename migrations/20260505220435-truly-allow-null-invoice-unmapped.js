'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE unmapped_invoice_products
      ALTER COLUMN invoice_id DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE unmapped_invoice_products
      SET invoice_id = (
        SELECT id FROM invoices LIMIT 1
      )
      WHERE invoice_id IS NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE unmapped_invoice_products
      ALTER COLUMN invoice_id SET NOT NULL;
    `);
  }
};