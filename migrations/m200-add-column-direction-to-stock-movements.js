'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_movements', 'direction', {
      type: Sequelize.ENUM('IN', 'OUT'),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('stock_movements', 'direction');

    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_stock_movements_direction";
    `);
  },
};