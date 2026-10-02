'use strict';

// Roda depois da m301 (linhas de grupo em payment_methods). Só mapeia o que
// consegue; o que não mapeia fica como está. Não mexe em
// pdv_sales_requests.payment_method_matches_receipt (valor já calculado).

// Descrição sem acento/caixa -> id_system do grupo; null = ambíguo/sem regra.
const GROUP_KEY_BY_DESCRIPTION = `
  CASE
    WHEN d LIKE '%credito%' AND d LIKE '%debito%' THEN NULL
    WHEN d LIKE '%pix%' THEN '17'
    WHEN d LIKE '%credito%' THEN '3'
    WHEN d LIKE '%debito%' THEN '4'
    WHEN d LIKE '%transfer%' OR d LIKE '%deposito%' THEN '18'
    WHEN d LIKE '%dinheiro%' THEN '1'
    WHEN d LIKE '%cheque%' THEN '2'
    WHEN d LIKE '%boleto%' THEN '15'
  END`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const run = (sql) => sequelize.query(sql, { transaction });

      // 1) Formas antigas (payment_type nulo) -> linha de grupo equivalente.
      await run(`
        CREATE TEMP TABLE legacy_payment_method_map ON COMMIT DROP AS
        SELECT pm.id AS old_id, g.id AS group_id, g.description AS group_description
        FROM payment_methods pm
        CROSS JOIN LATERAL (
          SELECT translate(lower(pm.description), 'áàâãäéèêíìóòôõöúùûüç', 'aaaaaeeeiioooooouuuuc') AS d
        ) n
        JOIN payment_methods g
          ON g.id_system = (${GROUP_KEY_BY_DESCRIPTION}) AND g.payment_type IS NOT NULL
        WHERE pm.payment_type IS NULL
      `);

      await run(`
        UPDATE order_payments op
        SET payment_method_id = m.group_id, updated_at = NOW()
        FROM legacy_payment_method_map m
        WHERE op.payment_method_id = m.old_id
      `);

      // Snapshot da forma dentro de cada comprovante.
      await run(`
        UPDATE pdv_sales_request_receipts r
        SET analysis = jsonb_set(
              r.analysis, '{payment_method}',
              jsonb_build_object('id', m.group_id, 'description', m.group_description)
            ),
            updated_at = NOW()
        FROM legacy_payment_method_map m
        WHERE r.analysis->'payment_method'->>'id' = CAST(m.old_id AS text)
      `);

      // Snapshot no resumo conciliado da solicitação.
      await run(`
        UPDATE pdv_sales_requests s
        SET payment_receipt_analysis = jsonb_set(
              s.payment_receipt_analysis, '{payment_methods}',
              (
                SELECT COALESCE(jsonb_agg(DISTINCT
                  CASE WHEN m.old_id IS NOT NULL
                    THEN jsonb_build_object('id', m.group_id, 'description', m.group_description)
                    ELSE e
                  END), '[]'::jsonb)
                FROM jsonb_array_elements(s.payment_receipt_analysis->'payment_methods') e
                LEFT JOIN legacy_payment_method_map m ON CAST(m.old_id AS text) = e->>'id'
              )
            ),
            updated_at = NOW()
        WHERE jsonb_typeof(s.payment_receipt_analysis->'payment_methods') = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(s.payment_receipt_analysis->'payment_methods') e
            JOIN legacy_payment_method_map m ON CAST(m.old_id AS text) = e->>'id'
          )
      `);

      // Só apaga a forma antiga se nada mais aponta pra ela.
      await run(`
        DELETE FROM payment_methods pm
        USING legacy_payment_method_map m
        WHERE pm.id = m.old_id
          AND NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.payment_method_id = pm.id)
      `);

      // 2) Comprovantes com tipo mas sem forma -> grupo do tipo.
      await run(`
        UPDATE pdv_sales_request_receipts r
        SET analysis = r.analysis || jsonb_build_object(
              'payment_method',
              jsonb_build_object('id', g.id, 'description', g.description)
            ),
            updated_at = NOW()
        FROM payment_methods g
        WHERE g.payment_type IS NOT NULL
          AND g.id_system = CASE r.analysis->>'tipo_comprovante'
            WHEN 'pix' THEN '17'
            WHEN 'cartao_credito' THEN '3'
            WHEN 'cartao_debito' THEN '4'
            WHEN 'transferencia' THEN '18'
          END
          AND (r.analysis->'payment_method' IS NULL
               OR jsonb_typeof(r.analysis->'payment_method') = 'null')
      `);

      // 3) Resumo conciliado sem formas -> formas distintas dos comprovantes.
      await run(`
        UPDATE pdv_sales_requests s
        SET payment_receipt_analysis = s.payment_receipt_analysis
              || jsonb_build_object('payment_methods', pm.methods),
            updated_at = NOW()
        FROM (
          SELECT r.pdv_sales_request_id AS request_id,
                 jsonb_agg(DISTINCT r.analysis->'payment_method')
                   FILTER (WHERE jsonb_typeof(r.analysis->'payment_method') = 'object') AS methods
          FROM pdv_sales_request_receipts r
          GROUP BY r.pdv_sales_request_id
        ) pm
        WHERE s.id = pm.request_id
          AND pm.methods IS NOT NULL
          AND s.payment_receipt_analysis IS NOT NULL
          AND (
            jsonb_typeof(s.payment_receipt_analysis->'payment_methods') IS DISTINCT FROM 'array'
            OR jsonb_array_length(s.payment_receipt_analysis->'payment_methods') = 0
          )
      `);
    });
  },

  async down() {
    // Sem volta: não dá pra saber quais vínculos existiam antes.
  },
};
