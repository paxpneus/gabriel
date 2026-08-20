'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'product_brand',
      {
        type: Sequelize.STRING(100),
        allowNull: true,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'product_measure',
      {
        type: Sequelize.STRING(50),
        allowNull: true,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'tax_commission_allocated',
      {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
        defaultValue: 0,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'freight_cost_allocated',
      {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
        defaultValue: 0,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'computed_icms_value_allocated',
      {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
        defaultValue: 0,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'contribution_value',
      {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
        defaultValue: 0,
      }
    );

    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'contribution_pct',
      {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
        defaultValue: 0,
      }
    );

    await queryInterface.addIndex(
      'sales_order_item_snapshots',
      ['product_measure'],
      {
        name: 'idx_sales_order_item_snapshots_product_measure',
      }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      'sales_order_item_snapshots',
      'idx_sales_order_item_snapshots_product_measure'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'contribution_pct'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'contribution_value'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'computed_icms_value_allocated'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'freight_cost_allocated'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'tax_commission_allocated'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'product_measure'
    );

    await queryInterface.removeColumn(
      'sales_order_item_snapshots',
      'product_brand'
    );
  },
};