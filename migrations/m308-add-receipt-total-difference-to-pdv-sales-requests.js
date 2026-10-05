'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'pdv_sales_requests',
      'receipt_total_difference',
      {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      'pdv_sales_requests',
      'receipt_total_difference',
    );
  },
};
