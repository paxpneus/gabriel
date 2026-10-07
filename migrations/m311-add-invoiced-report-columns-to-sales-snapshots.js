'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_order_snapshots', 'net_value', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });
    await queryInterface.addColumn('sales_order_snapshots', 'seller_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'contacts', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('sales_order_item_snapshots', 'net_value', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });
    await queryInterface.addColumn(
      'sales_order_item_snapshots',
      'kit_multiplier',
      {
        type: Sequelize.DECIMAL(14, 4),
        allowNull: true,
        defaultValue: 1,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sales_order_item_snapshots', 'kit_multiplier');
    await queryInterface.removeColumn('sales_order_item_snapshots', 'net_value');
    await queryInterface.removeColumn('sales_order_snapshots', 'seller_id');
    await queryInterface.removeColumn('sales_order_snapshots', 'net_value');
  },
};
