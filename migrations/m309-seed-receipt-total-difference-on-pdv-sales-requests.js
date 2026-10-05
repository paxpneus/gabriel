'use strict';

// Backfill de receipt_total_difference — mesma conta de receiptTotalDifference
// (helpers/receipt-reconciliation.ts). Só esta coluna muda; nem updated_at.
// valor_total antigo pode estar como string ("4401.46") no JSONB — aceita os dois.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE pdv_sales_requests psr
       SET receipt_total_difference =
         ROUND((psr.payment_receipt_analysis->>'valor_total')::numeric - o.net_total_order, 2)
       FROM orders o
       WHERE o.id = psr.order_id
         AND (psr.payment_receipt_analysis->>'valor_total') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
         AND o.net_total_order IS NOT NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE pdv_sales_requests SET receipt_total_difference = NULL`,
    );
  },
};
