'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'pdv_sales_requests',
      'receipt_total_matches_order',
      {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      'pdv_sales_requests',
      'receipt_total_matches_order',
    );
  },
};
