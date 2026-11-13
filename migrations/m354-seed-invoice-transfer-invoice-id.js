'use strict';

// Preenche transfer_invoice_id das vendas antigas só se o número da referência é de UMA transferência entre lojas
// e o PDV confirmou o par (venda + transferência). O resto fica nulo e a validação cai no fallback por número.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      WITH internal_op AS (
        SELECT id FROM invoice_operations WHERE code = '50'
      ),
      transfers AS (
        SELECT i.id, LTRIM(i.number_system, '0') AS n
        FROM invoices i
        WHERE i.sender_cnpj   IN (SELECT cnpj FROM unit_businesses WHERE cnpj IS NOT NULL)
          AND i.receiver_cnpj IN (SELECT cnpj FROM unit_businesses WHERE cnpj IS NOT NULL)
          AND i.sender_cnpj <> i.receiver_cnpj
          AND (i.invoice_operation_id IS NULL OR i.invoice_operation_id IS DISTINCT FROM (SELECT id FROM internal_op))
          AND NULLIF(LTRIM(i.number_system, '0'), '') IS NOT NULL
      ),
      unique_transfers AS (
        SELECT MIN(id::text)::uuid AS id, n FROM transfers GROUP BY n HAVING COUNT(*) = 1
      )
      UPDATE invoices s
      SET transfer_invoice_id = t.id, updated_at = NOW()
      FROM unique_transfers t
      WHERE s.transfer_invoice_id IS NULL
        AND s.id <> t.id
        AND t.n = LTRIM(SUBSTRING(s.transfer_invoice_reference, '\\d+'), '0')
        AND EXISTS (
          SELECT 1 FROM pdv_sales_requests p
          WHERE p.sale_invoice_id = s.id AND p.transfer_invoice_id = t.id
        )
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE invoices SET transfer_invoice_id = NULL WHERE transfer_invoice_id IS NOT NULL`);
  },
};
