'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const money = {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    };

    const highPrecisionMoney = {
      type: Sequelize.DECIMAL(14, 4),
      allowNull: true,
      defaultValue: 0,
    };

    // Novas despesas/descontos
    await queryInterface.addColumn('invoice_fiscal_items', 'freight_value', money);
    await queryInterface.addColumn('invoice_fiscal_items', 'insurance_value', money);
    await queryInterface.addColumn('invoice_fiscal_items', 'other_expenses_value', money);
    await queryInterface.addColumn('invoice_fiscal_items', 'discount_value', money);

    // Impostos adicionais
    await queryInterface.addColumn('invoice_fiscal_items', 'icms_st_value', money);

    // Custo unitário calculado (4 casas decimais para precisão de centavos)
    await queryInterface.addColumn('invoice_fiscal_items', 'acquisition_unit_cost', highPrecisionMoney);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoice_fiscal_items', 'freight_value');
    await queryInterface.removeColumn('invoice_fiscal_items', 'insurance_value');
    await queryInterface.removeColumn('invoice_fiscal_items', 'other_expenses_value');
    await queryInterface.removeColumn('invoice_fiscal_items', 'discount_value');
    await queryInterface.removeColumn('invoice_fiscal_items', 'icms_st_value');
    await queryInterface.removeColumn('invoice_fiscal_items', 'acquisition_unit_cost');
  }
};