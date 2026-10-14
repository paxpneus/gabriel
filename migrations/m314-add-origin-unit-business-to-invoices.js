'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'origin_unit_business_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'unit_businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoices', 'origin_unit_business_id');
  },
};
