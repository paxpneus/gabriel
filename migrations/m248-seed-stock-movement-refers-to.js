'use strict';

// Backfill pontual: preenche refers_to nos MANUAL_ADJUSTMENT existentes que
// já seguem o padrão de correção de custo de nota fiscal — custo médio
// manual preenchido e, pro mesmo produto/unit_business, uma PURCHASE_ENTRY
// com invoice_number até 1 dia antes (a PURCHASE_ENTRY mais recente dentro
// dessa janela, não precisa ser a movimentação imediatamente anterior).
// Idempotente: só toca em quem ainda não tem refers_to, pode ser reexecutada.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        UPDATE stock_movements ma
        SET refers_to = pe.invoice_number
        FROM stock_movements ma2
        JOIN LATERAL (
          SELECT pe_inner.invoice_number, pe_inner.movement_date
          FROM stock_movements pe_inner
          WHERE pe_inner.product_id = ma2.product_id
            AND pe_inner.unit_business_id = ma2.unit_business_id
            AND pe_inner.movement_type = 'PURCHASE_ENTRY'
            AND pe_inner.movement_date <= ma2.movement_date
          ORDER BY pe_inner.movement_date DESC, pe_inner.created_at DESC
          LIMIT 1
        ) pe ON pe.movement_date >= ma2.movement_date - INTERVAL '1 day'
        WHERE ma.id = ma2.id
          AND ma2.movement_type = 'MANUAL_ADJUSTMENT'
          AND ma2.manual_average_cost_value IS NOT NULL
          AND ma2.refers_to IS NULL
          AND pe.invoice_number IS NOT NULL
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE stock_movements SET refers_to = NULL`,
    );
  },
};
