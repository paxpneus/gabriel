'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'store_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'stores',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('stocks', 'unit_business_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'unit_businesses',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'store_id');
    await queryInterface.removeColumn('stocks', 'unit_business_id');
  }
};