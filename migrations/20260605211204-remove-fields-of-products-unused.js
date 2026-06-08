'use strict';

module.exports = {
  async up(queryInterface) {
    const cols = [
      'sku',
      'price',
      'supplier_cost_price',
      'supplier_purchase_price',
      'average_cost',
      'average_cost_updated_at',
      'ncm',
      'cest',
      'gtin',
      'gtin_package',
    ];

    for (const col of cols) {
      await queryInterface.sequelize.query(`
        ALTER TABLE products DROP COLUMN IF EXISTS "${col}";
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'sku', { type: Sequelize.STRING(100), allowNull: true });
    await queryInterface.addColumn('products', 'price', { type: Sequelize.FLOAT, allowNull: true, defaultValue: 0 });
    await queryInterface.addColumn('products', 'supplier_cost_price', { type: Sequelize.DECIMAL(14, 4), allowNull: true });
    await queryInterface.addColumn('products', 'supplier_purchase_price', { type: Sequelize.DECIMAL(14, 4), allowNull: true });
    await queryInterface.addColumn('products', 'average_cost', { type: Sequelize.DECIMAL(14, 4), allowNull: true });
    await queryInterface.addColumn('products', 'average_cost_updated_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('products', 'ncm', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('products', 'cest', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('products', 'gtin', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('products', 'gtin_package', { type: Sequelize.STRING(20), allowNull: true });
  },
};