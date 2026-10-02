'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pdv_sales_requests', 'shipping_address', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('pdv_sales_requests', 'transporter_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pdv_sales_requests', 'transporter_name');
    await queryInterface.removeColumn('pdv_sales_requests', 'shipping_address');
  },
};
