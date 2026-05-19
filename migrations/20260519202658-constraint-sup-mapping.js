'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE product_supplier_maps
      DROP CONSTRAINT IF EXISTS product_supplier_maps_product_id_supplier_cnpj_unique;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE product_supplier_maps
      ADD CONSTRAINT product_supplier_maps_product_id_supplier_product_code_unique
      UNIQUE (product_id, supplier_product_code);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE product_supplier_maps
      DROP CONSTRAINT IF EXISTS product_supplier_maps_product_id_supplier_product_code_unique;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE product_supplier_maps
      ADD CONSTRAINT product_supplier_maps_product_id_supplier_cnpj_unique
      UNIQUE (product_id, supplier_cnpj);
    `);
  },
};