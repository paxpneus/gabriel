'use strict';

// ORDER: pedido mapeado por integração (Bling: id do pedido; Magento: entity_id do pedido do site).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_integration_mappings_entity_type"
      ADD VALUE IF NOT EXISTS 'ORDER';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
