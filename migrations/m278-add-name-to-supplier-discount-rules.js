'use strict';

// `name` é sempre calculado pelo backend (buildSupplierDiscountRuleName em
// supplier-discount-rule.service.ts), nunca aceito do client. Nullable aqui
// de propósito — regras já existentes não têm valor ainda; m279 faz o
// backfill e só então aperta pra NOT NULL.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('supplier_discount_rules', 'name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('supplier_discount_rules', 'name');
  },
};
