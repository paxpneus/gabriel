'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_order_snapshots', 'computed_icms_value', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    });


  },

  async down(queryInterface) {

    await queryInterface.removeColumn('sales_order_snapshots', 'computed_icms_value');
  },
};