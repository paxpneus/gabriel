'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pdv_sales_requests', 'origin', {
      type: Sequelize.ENUM('TELEVENDAS', 'LOJA'),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pdv_sales_requests', 'origin');

    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_pdv_sales_requests_origin";
    `);
  },
};
