'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {

    const highPrecisionMoney = {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true,
      defaultValue: 0,
    };

    await queryInterface.addColumn('stock_movements', 'manual_discount_value', highPrecisionMoney);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('stock_movements', 'manual_discount_value');
  }
};