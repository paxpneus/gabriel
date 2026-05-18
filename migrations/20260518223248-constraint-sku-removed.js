'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE products
      DROP CONSTRAINT IF EXISTS products_sku_key;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE products
      ADD CONSTRAINT products_sku_key UNIQUE (sku);
    `);
  },
};