'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_movements', 'status', {
      type: Sequelize.ENUM('PENDING', 'SYNCHED'),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('stock_movements', 'status');

    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_stock_movements_status";
    `);
  },
};