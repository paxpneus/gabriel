'use strict';

// Espelha src/modules/sales/orders/payment_method/helpers/payment-method-groups.ts
const GROUPS = [
  { key: '1', description: 'Dinheiro', blingTypes: [1] },
  { key: '2', description: 'Cheque', blingTypes: [2] },
  { key: '3', description: 'Cartão de Crédito', blingTypes: [3] },
  { key: '4', description: 'Cartão de Débito', blingTypes: [4] },
  { key: '15', description: 'Boleto Bancário', blingTypes: [15] },
  { key: '17', description: 'Pix', blingTypes: [17, 20] },
  { key: '18', description: 'Transferência Bancária', blingTypes: [16, 18] },
  { key: '99', description: 'Outros', blingTypes: [99] },
];
const OTHER_KEY = '99';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const [integration] = await sequelize.query(
        `SELECT id FROM integrations WHERE name = 'Bling' AND type = 'SYSTEM' LIMIT 1`,
        { type: 'SELECT', transaction },
      );
      if (!integration) throw new Error('Integração Bling não encontrada');

      await sequelize.query(
        `INSERT INTO payment_methods (id, integrations_id, id_system, description, payment_type, raw_payload, created_at, updated_at)
         SELECT gen_random_uuid(), :integrationId, g->>'key', g->>'description', (g->>'key')::int,
                jsonb_build_object('blingTypes', g->'blingTypes'), NOW(), NOW()
         FROM jsonb_array_elements(CAST(:groups AS jsonb)) g
         ON CONFLICT (id_system) DO UPDATE SET
           description = EXCLUDED.description,
           payment_type = EXCLUDED.payment_type,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = NOW()`,
        {
          replacements: {
            integrationId: integration.id,
            groups: JSON.stringify(GROUPS),
          },
          transaction,
        },
      );

      // Formas antigas (uma linha por forma da Bling, id_system = id da forma)
      // são consolidadas na linha do grupo pelo payment_type.
      const typeToKey = GROUPS.flatMap((g) =>
        g.blingTypes.map((type) => [type, g.key]),
      );
      const replacements = {
        typeToKey: JSON.stringify(
          typeToKey.map(([type, key]) => ({ type, key })),
        ),
        groupKeys: GROUPS.map((g) => g.key),
        otherKey: OTHER_KEY,
      };
      const oldRows = `
        SELECT pm.id AS old_id, COALESCE(m.key, :otherKey) AS group_key
        FROM payment_methods pm
        LEFT JOIN jsonb_to_recordset(CAST(:typeToKey AS jsonb)) AS m(type int, key text)
          ON m.type = pm.payment_type
        WHERE pm.payment_type IS NOT NULL AND pm.id_system NOT IN (:groupKeys)`;

      await sequelize.query(
        `UPDATE order_payments op SET payment_method_id = g.id, updated_at = NOW()
         FROM (${oldRows}) old
         JOIN payment_methods g ON g.id_system = old.group_key
         WHERE op.payment_method_id = old.old_id`,
        { replacements, transaction },
      );

      await sequelize.query(
        `DELETE FROM payment_methods pm
         USING (${oldRows}) old
         WHERE pm.id = old.old_id
           AND NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.payment_method_id = pm.id)`,
        { replacements, transaction },
      );
    });
  },

  async down() {
    // Sem volta: as formas por-conta antigas se recriam no próximo sync.
  },
};
