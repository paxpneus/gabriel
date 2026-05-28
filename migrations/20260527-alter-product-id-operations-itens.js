'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE operations_itens
      ALTER COLUMN product_id DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE operations_itens
      ALTER COLUMN product_id SET NOT NULL;
    `);
  },
};
