'use strict';

// Suporta o reprocessamento retroativo de supplier_discount_rules
// (findOrderIdsAffectedBySupplierDiscountRuleChanges, em
// sales-report.repository.ts), que filtra sales_order_item_snapshots por
// supplier_discount_rule_id pra achar pedidos já fechados cujo desconto
// precisa ser recalculado quando uma regra é criada/editada/(des)ativada.
// Sem índice, esse filtro varreria a tabela inteira a cada rodada do job.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addIndex(
        'sales_order_item_snapshots',
        ['supplier_discount_rule_id'],
        {
          name: 'idx_sois_supplier_discount_rule_id',
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeIndex(
        'sales_order_item_snapshots',
        'idx_sois_supplier_discount_rule_id',
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
