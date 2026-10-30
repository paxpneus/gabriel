'use strict';

// reserved_quantity (físico - virtual) e virtual_stock (saldoVirtualTotal) da Bling: só leitura pro front, nenhum fluxo usa.
// null = nunca veio da Bling (ex.: loja Tecinco); nos itens do inventário guardam o valor da criação (CYCLIC acompanha o sync).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stocks', 'reserved_quantity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('stocks', 'virtual_stock', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('inventory_batch_items', 'reserved_quantity', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('inventory_batch_items', 'virtual_stock', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('inventory_batch_items', 'virtual_stock');
    await queryInterface.removeColumn('inventory_batch_items', 'reserved_quantity');
    await queryInterface.removeColumn('stocks', 'virtual_stock');
    await queryInterface.removeColumn('stocks', 'reserved_quantity');
  },
};
