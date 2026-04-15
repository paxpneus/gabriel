'use strict';

module.exports = {
  async up(queryInterface) {
    // 1. Remove constraint antiga (unique direto na coluna)
    await queryInterface.sequelize.query(`
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_ean_key;
    `);

    // 2. Remove índices antigos que possam conflitar
    await queryInterface.removeIndex('products', 'products_ean_unique_idx').catch(() => {});
    await queryInterface.removeIndex('products', 'products_ean_unique').catch(() => {});
    await queryInterface.removeIndex('products', 'products_ean_unique_not_null').catch(() => {});

    // 3. Cria o índice correto (permite NULL e vazio)
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX products_ean_unique_idx 
      ON products(ean) 
      WHERE ean IS NOT NULL AND ean <> '';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS products_ean_unique_idx;
    `);
  },
};