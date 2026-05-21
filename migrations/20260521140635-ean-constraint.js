'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX products_ean_unique 
      ON products (ean) 
      WHERE ean IS NOT NULL AND ean != '';
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX products_ean_tribut_unique 
      ON products (ean_tribut) 
      WHERE ean_tribut IS NOT NULL AND ean_tribut != '';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS products_ean_unique;
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS products_ean_tribut_unique;
    `);
  },
};