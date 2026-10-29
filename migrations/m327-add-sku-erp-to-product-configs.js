'use strict';

// sku_erp: SKU cru que o ERP manda pro produto (mapping principal), gravado mesmo quando sku é omitido
// (duplicado no catálogo, já de outro produto). Só leitura — sem leitor ainda, gravado pra uso futuro.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_configs', 'sku_erp', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_configs', 'sku_erp');
  },
};
