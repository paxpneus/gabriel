'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Regra de negócio: 1 produto = 1 linha fiscal por invoice.
      // A chave real é (invoice_id, product_id) — as outras duas
      // constraints eram resquício de um modelo anterior (uma linha
      // por item do XML) e hoje só atrapalham o upsert, causando
      // SequelizeUniqueConstraintError mesmo quando o conflict target
      // correto (invoice_id, product_id) não tem conflito nenhum.

      await queryInterface.removeConstraint(
        'invoice_fiscal_items',
        'invoice_fiscal_items_invoice_sku_cfop_unique',
        { transaction }
      );

      await queryInterface.removeConstraint(
        'invoice_fiscal_items',
        'invoice_fiscal_items_invoice_id_item_number_unique',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Recria as constraints originais, caso seja preciso reverter.
      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'sku', 'cfop'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_sku_cfop_unique',
        transaction,
      });

      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'item_number'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_id_item_number_unique',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};