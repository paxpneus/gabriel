'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {

    const highPrecisionMoney = {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true,
      defaultValue: null,
    };

    await queryInterface.addColumn('stock_movements', 'manual_average_cost_value', highPrecisionMoney);

    await queryInterface.removeColumn('stock_movements', 'manual_discount_value');

  },

  async down(queryInterface, Sequelize) {
     const highPrecisionMoney = {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true,
      defaultValue: 0,
    };

    await queryInterface.addColumn('stock_movements', 'manual_discount_value', highPrecisionMoney);

    await queryInterface.removeColumn('stock_movements', 'manual_average_cost_value');

  }
};