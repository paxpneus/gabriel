'use strict';

// gtin_erp: EAN cru que o ERP manda pro produto (mapping principal), gravado mesmo quando gtin é omitido
// (override físico, duplicado no catálogo, conflito). Só leitura — consumido só pelo relatório de divergência.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_configs', 'gtin_erp', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_configs', 'gtin_erp');
  },
};
