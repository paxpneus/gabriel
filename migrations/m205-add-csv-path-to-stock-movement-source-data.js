'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_movement_source_data', 'csv_path', {
      type: Sequelize.STRING(1024),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('stock_movement_source_data', 'csv_path');
  },
};
