'use strict';

const { randomUUID } = require('crypto');

// Reproduz o algoritmo hoje usado em bling-order.service.ts (getKitMultiplier +
// busca do ProductConfig unitário) e em sales-report.repository.ts (regex SQL):
// um product_config do tipo KIT com sku terminando em K{n} representa n unidades
// reais do product_config de tipo UNIT com o mesmo sku sem o sufixo, na mesma loja.
const SEED_QUERY = `
  SELECT
    kit_pc.product_id  AS product_kit_id,
    unit_pc.product_id AS product_component_id,
    (regexp_match(kit_pc.sku, 'K([0-9]+)$', 'i'))[1]::int AS quantity
  FROM product_configs kit_pc
  JOIN products kit_p
    ON kit_p.id = kit_pc.product_id AND kit_p.type = 'KIT'
  JOIN product_configs unit_pc
    ON unit_pc.unit_business_id = kit_pc.unit_business_id
    AND unit_pc.sku = regexp_replace(kit_pc.sku, 'K[0-9]+$', '', 'i')
  JOIN products unit_p
    ON unit_p.id = unit_pc.product_id AND unit_p.type = 'UNIT'
  WHERE kit_pc.sku ~* 'K[0-9]+$'
`;

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const [rows] = await queryInterface.sequelize.query(SEED_QUERY, {
        transaction,
      });

      const byPair = new Map();
      const conflicts = [];

      for (const row of rows) {
        const key = `${row.product_kit_id}::${row.product_component_id}`;
        const existing = byPair.get(key);

        if (!existing) {
          byPair.set(key, row.quantity);
        } else if (existing !== row.quantity) {
          conflicts.push({
            product_kit_id: row.product_kit_id,
            product_component_id: row.product_component_id,
            quantities: [existing, row.quantity],
          });
        }
      }

      if (conflicts.length > 0) {
        console.warn(
          `[seed-kit-components-from-sku] ${conflicts.length} par(es) kit/componente com quantidade divergente entre lojas — usando a primeira quantidade encontrada. Revisar manualmente:`,
          JSON.stringify(conflicts, null, 2),
        );
      }

      if (byPair.size > 0) {
        const now = new Date();
        const records = Array.from(byPair.entries()).map(([key, quantity]) => {
          const [product_kit_id, product_component_id] = key.split('::');
          return {
            id: randomUUID(),
            product_kit_id,
            product_component_id,
            quantity,
            created_at: now,
            updated_at: now,
          };
        });

        await queryInterface.bulkInsert('kit_components', records, {
          transaction,
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('kit_components', {});
  },
};
