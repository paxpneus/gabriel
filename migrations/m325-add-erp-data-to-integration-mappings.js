'use strict';

// erp_data: snapshot só-leitura do que o ERP mandou pra esse external_id (PRODUCT: nome, ean, sku, estoque),
// gravado pelo sync tanto no mapping principal quanto no não principal. Nunca usado em resolução.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_mappings', 'erp_data', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('integration_mappings', 'erp_data');
  },
};
