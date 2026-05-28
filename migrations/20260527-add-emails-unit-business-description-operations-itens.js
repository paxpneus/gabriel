'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add emails column to unit_businesses
    await queryInterface.addColumn('unit_businesses', 'emails', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true,
      defaultValue: [],
    });

    // Add description column to operations_itens
    await queryInterface.addColumn('operations_itens', 'description', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove emails column from unit_businesses
    await queryInterface.removeColumn('unit_businesses', 'emails');

    // Remove description column from operations_itens
    await queryInterface.removeColumn('operations_itens', 'description');
  },
};
